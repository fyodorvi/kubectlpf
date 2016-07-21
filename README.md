# Kubectlpf

A small cli utility to do batch forwarding for kubectl pods. With auto-restart feature if pod appears to be dead.

## Installation

```
npm i kubectlpf -g
```

## Usage:

```
kubectlf [<podname[:port]>]... [--namepsace=<namespace>] [--exclude=<podname>...]
```

Port is optional if you have pods config which should be stored in `~/kube/pods.json`.
It should have ` podname: port ` format:

```
{
    "somepod": "3000"
}
```

If no podname is provided the script will search for local `pods.json` (same ` podname: port ` format), and run port forward for all of them. Use `exclude` param to exclude some of them for that case.
