# Kubectlpf

A small cli utility to do batch forwarding for kubectl pods. With auto-restart feature if pod (or network) appears to be dead.

## Installation

```
npm i kubectlpf -g
```

## Usage:

```
kubectlpf [<podname[:port]>]... [--namepsace=<namespace>] [--exclude=<podname>...] [--health-interval=<number>]
```

Note that pod name accepts partial naming match, e.g. you pod name is `car-service`, you may just type `kubctlpf car`.
Port is optional if you have pods config which should be stored in `~/kube/pods.json`.
It should have ` podname: port ` format:

```
{
    "somepod": "3000"
}
```

If no podname is provided the script will search for local `pods.json` (same ` podname: port ` format), and run port forward for all of them. Use `exclude` param to exclude some of them for that case.
Use `health-interval` to set custom health check interval in milliseconds (default is `5000`).
