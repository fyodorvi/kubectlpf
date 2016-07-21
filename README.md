# Kubectlpf

A small utility to do batch forwarding for kubectl pods. With auto-restart feature if pod appears to be dead.

## Installation

```
npm i kubectlpf -g
```

## Usage:

```
kubectlf <podname[:port]>...
```

Port is optional if you have pods config which should be stored in `~/kube/pods.json`.
It should have ` podname: port ` format:

```
{
    "somepod": "3000"
}
```
