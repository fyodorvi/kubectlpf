#! /usr/bin/env node

'use strict';

const exec = require('child_process').exec;
const fs = require('fs');
const chalk = require('chalk');
const timestamp = require('time-stamp');

let portMaps;

const childProcesses = [];

const path = require('path');
function resolveHome(filepath) {
    if (filepath[0] === '~') {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return path;
}

try {
    portMaps = JSON.parse(fs.readFileSync(resolveHome('~/.kube/pods.json'), 'utf-8'));
}
catch (e) {
    portMaps = {};
}

function timeLog (line) {
	console.log(`[${chalk.grey(timestamp('HH:mm:ss'))}] ${line}`);
}

function getPods(callback) {
    exec('kubectl get pods', function(error, stdout, stderr){
        if (error) {
            throw stderr;
        }
        callback(stdout);
    });
}

function getPodId(pods, podName, silent){
    const match = (new RegExp('('+podName+'[-\\da-z]*).*(Running)', 'g')).exec(pods);
    if (match) {
        return match[1];
    } else {
        const errorMatch = (new RegExp('('+podName+'[-\\da-z]*)[\\s]*[\\d]\\/[\\d][\\s]*([a-zA-Z]*)[\\s]', 'g')).exec(pods);
        if (errorMatch) {
			if (silent) {
				return false;
			} else {
				throw `Pod ${chalk.cyan(podName)} is in ${chalk.cyan(errorMatch[2])} state, needs to be ${chalk.cyan('Running')}`;
			}
        } else {
			if (silent) {
				return false;
			} else {
				throw `Could not find pod ${chalk.cyan(podName)}, available pods: \n${pods}`;
			}
        }
    }
}

function portForwardPod(pod) {
    const child = exec(`kubectl port-forward ${pod.id} ${pod.port}`);

    child.stdout.on('data', function(data) {
        processKubectlLog(data, pod, child);
    });
    child.stderr.on('data', function(data) {
        processKubectlLog(data, pod, child);
    });
    child.on('close', function(code) {
        //nothing for now
    });

	childProcesses.push(child);
}

function processKubectlLog(logLine, pod, child) {
    if (logLine.match(/Forwarding from/)) {
    	if (!pod.initialized) {
			pod.initialized = true;
			timeLog(`Started port forwarding for ${chalk.cyan(pod.name)} on port ${chalk.magenta(pod.port)}`);
		}
    } else if (logLine.match(/Handling connectionx/)) {
		timeLog(`Processing request for ${chalk.cyan(pod.name)}`);
	} else if (logLine.match(/an error occurred forwarding/)) {
		timeLog(`Pod ${chalk.cyan(pod.name)} appears to be dead. Trying to initialize again...`);
		childProcesses.splice(childProcesses.indexOf(child));
		child.kill();
		pod.initialized = false;
		let attempt = 0;
		const maxAttempt = 10;
		const timeOutDuration = 5000;
		const tryReinitPod = () => {
			getPods((rawPods) => {
				const podId = getPodId(rawPods, pod.name, true);
				if (podId) {
					pod.id = podId;
					portForwardPod(pod);
				} else {
					if (attempt >= maxAttempt) {
						timeLog(chalk.red(`Failed to resume forwarding for ${chalk.cyan(pod.name)}`));
					} else {
						timeLog(`Waiting for ${chalk.cyan(pod.name)} to come up (${maxAttempt - attempt})...`);
						attempt++;
						setTimeout(tryReinitPod, timeOutDuration)
					}
				}
			});
		}
		tryReinitPod();
    } else {
    	if (!pod.initialized) {
    		// must be true error message
			timeLog(chalk.red(`Failed to initialize port forwarding for ${chalk.cyan(pod.name)} on port ${chalk.magenta(pod.port)}: \n`));
			console.log(logLine);
			process.exit();
		} else {
			timeLog(`${chalk.blue(pod.name)}: ` +logLine);
		}
    }
}

try {
    if (process.argv.length <= 2) {
        throw 'Please provide pod names';
    } else {
        const pods = [];
        for (let i = 2; i < process.argv.length; i++) {
            let podName = process.argv[i];
            let podPort = portMaps[podName];
			const split = podName.split(':');
            if (split.length > 1) {
            	podName = split[0];
                podPort = split[1];
            }
            if (!portMaps[podName] && !podPort) {
                throw `Please specify port for ${chalk.cyan(podName)}`;
            } else {
                pods.push({
                    name: podName,
                    port: podPort
                });
            }
        }
        getPods(function (rawPods) {
        	try {
				pods.forEach((pod, key) => {
					pods[key].id = getPodId(rawPods, pod.name);
				});
				timeLog('Initializing...');
				pods.forEach((pod) => {
					portForwardPod(pod);
				});
			} catch (error) {
				timeLog(chalk.red(error));
			}
        });
    }
} catch (error) {
	timeLog(chalk.red(error));
}

process.on('exit', () => {
	childProcesses.forEach((child) => {
		child.kill();
	})
});
