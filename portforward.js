#! /usr/bin/env node

'use strict';

const exec = require('child_process').exec;
const fs = require('fs');
const chalk = require('chalk');
const timestamp = require('time-stamp');
const _ = require('lodash');

let systemDefinedPods;
let localDefinedPods;
let namespace;

const runningPods = [];

const path = require('path');
function resolveHome(filepath) {
    if (filepath[0] === '~') {
        return path.join(process.env.HOME, filepath.slice(1));
    }
    return path;
}

try {
    systemDefinedPods = JSON.parse(fs.readFileSync(resolveHome('~/.kube/pods.json'), 'utf-8'));
}
catch (e) {
    systemDefinedPods = {};
}

try {
	localDefinedPods = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'pods.json'), 'utf-8'));
}
catch (e) {
	localDefinedPods = {}
}

_.merge(systemDefinedPods, localDefinedPods);

function timeLog (line) {
	console.log(`[${chalk.grey(timestamp('HH:mm:ss'))}] ${line}`);
}

function getPods(callback) {
    exec(`kubectl get pods${ namespace ? ' --namespace='+namespace : ''}`, function(error, stdout, stderr){
        if (error) {
            throw stderr;
        }
        callback(stdout);
    });
}

function getPodId(rawPods, podName, silent){
    const match = (new RegExp('('+podName+'[-\\da-z]*).*(Running)', 'g')).exec(rawPods);
    if (match) {
        return match[1];
    } else {
        const errorMatch = (new RegExp('('+podName+'[-\\da-z]*)[\\s]*[\\d]\\/[\\d][\\s]*([a-zA-Z]*)[\\s]', 'g')).exec(rawPods);
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
				throw `Could not find pod ${chalk.cyan(podName)}, available pods${ namespace ? ' (namespace: '+namespace+')' : ''}: \n${rawPods}`;
			}
        }
    }
}

function portForwardPod(pod) {
    const child = exec(`kubectl port-forward ${pod.id} ${pod.port}${ namespace ? ' --namespace='+namespace : ''}`);

    child.stdout.on('data', function(data) {
        processKubectlLog(data, pod, child);
    });
    child.stderr.on('data', function(data) {
        processKubectlLog(data, pod, child);
    });
    child.on('close', function(code) {
        //nothing for now
    });

	pod.childProcess = child;
}

function healthCheck() {
	getPods((rawPods) => {
		runningPods.forEach(pod => {
			if (pod.initialized) {
				const match = (new RegExp('('+pod.id+').*(Running)', 'g')).exec(rawPods);
				if (!match) {
					pod.childProcess.kill();
					pod.initialized = false;
					timeLog(`Detected death of ${chalk.cyan(pod.name)}. Trying to restart port forwarding...`);
					let attempt = 0;
					const maxAttempt = 20;
					const attemptDuration = 5000;
					const tryReinitPod = () => {
						getPods((rawPods) => {
							const podId = getPodId(rawPods, pod.name, true);
							if (podId) {
								pod.id = podId;
								portForwardPod(pod);
							} else {
								if (attempt >= maxAttempt) {
									timeLog(chalk.red(`Failed to resume forwarding for ${chalk.cyan(pod.name)}`));
									process.exit();
								} else {
									timeLog(`Waiting for ${chalk.cyan(pod.name)} to come up (${attempt})...`);
									attempt++;
									setTimeout(tryReinitPod, attemptDuration)
								}
							}
						});
					};
					tryReinitPod();
				}
			}
		});
	});
}

function processKubectlLog(logLine, pod, child) {
    if (logLine.match(/Forwarding from/)) {
    	if (!pod.initialized) {
			pod.initialized = true;
			timeLog(`Started port forwarding for ${chalk.cyan(pod.name)} on port ${chalk.magenta(pod.port)}`);
		}
    } else if (logLine.match(/Handling connection/)) {
		timeLog(`Processing request for ${chalk.cyan(pod.name)}`);
	} else if (logLine.match(/an error occurred forwarding/)) {
		timeLog(`Unable to process request for ${chalk.cyan(pod.name)}`);
		healthCheck();
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
	const args = process.argv.slice(2);
	let podsToExclude = [];
	let podsToForward = [];
	let healthInterval = 5000;

	args.forEach(arg => {
		if (arg.match(/--namespace=[a-zA-z]*?/)) {
			namespace = arg.split('=')[1];
		} else if (arg.match(/--exclude=(?:[\-a-zA-Z]*,?)*/)) {
			podsToExclude = arg.split('=')[1].split(',').map((pod) => pod.trim());
		} else if (arg.match(/--health-interval=[\d]*?/)) {
			healthInterval = arg.split('=')[1];
		} else {
			podsToForward.push(arg);
		}
	});

	if (!podsToForward.length) {
		if (!_.isEmpty(localDefinedPods)) {
			timeLog('Forwarding ports for pods from pods.json');
			podsToForward = Object.keys(localDefinedPods);
		} else {
			throw 'No pod names provided';
		}
	}


	podsToForward.forEach((podName) => {
		if (podsToExclude.indexOf(podName) !== -1) {
			return;
		}
		let podPort = systemDefinedPods[podName];
		const split = podName.split(':');
		if (split.length > 1) {
			podName = split[0];
			podPort = split[1];
		}
		if (!systemDefinedPods[podName] && !podPort) {
			throw `Please specify port for ${chalk.cyan(podName)}`;
		} else {
			runningPods.push({
				name: podName,
				port: podPort
			});
		}
	});

	if (runningPods.length == 0) {
		throw 'No pod names provided';
	}

	timeLog('Initializing...');
	getPods(function (rawPods) {
		try {
			runningPods.forEach((pod, key) => {
				runningPods[key].id = getPodId(rawPods, pod.name);
			});
			runningPods.forEach((pod) => {
				portForwardPod(pod);
			});
			setInterval(healthCheck, healthInterval);
		} catch (error) {
			timeLog(chalk.red(error));
		}
	});

} catch (error) {
	timeLog(chalk.red(error));
}

process.on('exit', () => {
	runningPods.forEach((pod) => {
		try {
			pod.childProcess.kill();
		} catch (error) {

		}
	})
});
