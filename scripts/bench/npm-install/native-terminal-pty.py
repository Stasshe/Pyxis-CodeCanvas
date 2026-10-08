import argparse
import hashlib
import json
import os
import pty
import select
import struct
import subprocess
import termios
import time
from pathlib import Path


def read_until(fd, token, timeout):
    chunks = []
    data = bytearray()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        chunk = os.read(fd, 65536)
        if not chunk:
            break
        chunks.append(chunk)
        data.extend(chunk)
        if token in data:
            break
    return b"".join(chunks)


def run_trial(trial, root, cache, timeout, command_text, expected_added, expected_audited):
    prompt = f"__NPM_BENCH_PROMPT_{trial}__ ".encode()
    environment = os.environ.copy()
    environment["PS1"] = prompt.decode()
    environment["NPM_CONFIG_CACHE"] = str(cache)
    environment["TERM"] = "xterm-256color"
    master, slave = pty.openpty()
    fcntl_set_winsize(slave)
    process = subprocess.Popen(
        ["bash", "--noprofile", "--norc", "-i"],
        cwd=root,
        env=environment,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
    )
    os.close(slave)
    initial = read_until(master, prompt, 10)
    if prompt not in initial:
        process.kill()
        raise RuntimeError("Interactive shell did not show its initial prompt.")
    command = command_text.encode()
    os.write(master, command)
    typed_echo = read_until(master, command, 10)
    if command not in typed_echo:
        process.kill()
        process.wait(timeout=5)
        os.close(master)
        raise RuntimeError(f"Trial {trial} did not echo the complete command before Enter.")
    entered_at = time.perf_counter_ns()
    os.write(master, b"\n")
    output = typed_echo + read_until(master, prompt, timeout)
    finished_at = time.perf_counter_ns()
    if prompt not in output:
        process.kill()
        process.wait(timeout=5)
        os.close(master)
        raise RuntimeError(f"Trial {trial} did not return to its shell prompt.")
    decoded = output.decode(errors="replace")
    if f"added {expected_added} packages" not in decoded:
        process.kill()
        process.wait(timeout=5)
        os.close(master)
        raise RuntimeError(f"Trial {trial} installed an unexpected package count: {decoded[-1200:]}")
    if f"audited {expected_audited} packages" not in decoded:
        process.kill()
        process.wait(timeout=5)
        os.close(master)
        raise RuntimeError(f"Trial {trial} audited an unexpected package count: {decoded[-1200:]}")
    os.write(master, b"exit\n")
    process.wait(timeout=5)
    os.close(master)
    return {
        "trial": trial,
        "command": command_text,
        "enterToPromptMs": (finished_at - entered_at) / 1_000_000,
        "trustedEnter": True,
        "commandEchoedBeforeEnter": command in typed_echo,
        "promptMarker": prompt.decode(),
        "output": decoded,
        "cachePath": str(cache),
        "workspace": str(root),
    }


def fcntl_set_winsize(fd):
    import fcntl

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 11, 80, 0, 0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--trials", type=int, default=7)
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args()
    if args.trials < 5:
        raise ValueError("At least five trials are required.")

    fixture = json.loads(args.fixture.read_text())
    manifest_text = fixture["manifestText"]
    lockfile_text = fixture["lockfileText"]
    manifest = json.loads(manifest_text)
    lockfile = json.loads(lockfile_text) if lockfile_text else None
    manifest_hash = hashlib.sha256(manifest_text.encode()).hexdigest()
    lockfile_hash = hashlib.sha256(lockfile_text.encode()).hexdigest() if lockfile_text else None
    base = args.workspace.resolve() / "native-terminal-pty" / args.output.stem
    if base.exists():
        raise RuntimeError(f"Native PTY output workspace already exists: {base}")
    samples = []
    for trial in range(1, args.trials + 1):
        root = base / f"trial-{trial}" / "project"
        cache = base / f"trial-{trial}" / "npm-cache"
        root.mkdir(parents=True)
        cache.mkdir(parents=True)
        manifest_path = root / "package.json"
        lockfile_path = root / "package-lock.json"
        manifest_path.write_text(manifest_text)
        if lockfile_text:
            lockfile_path.write_text(lockfile_text)
        if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != manifest_hash:
            raise RuntimeError(f"Trial {trial} package.json differs from the frozen fixture.")
        if lockfile_text and hashlib.sha256(lockfile_path.read_bytes()).hexdigest() != lockfile_hash:
            raise RuntimeError(f"Trial {trial} package-lock.json differs from the frozen fixture.")
        sample = run_trial(
            trial,
            root,
            cache,
            args.timeout,
            fixture["command"],
            fixture.get("nativeExpectedAddedPackages", fixture["expectedAddedPackages"]),
            fixture["nativeExpectedAuditedPackages"],
        )
        samples.append(sample)
        print(f"native PTY trial {trial}/{args.trials}: {sample['enterToPromptMs']:.1f} ms", flush=True)

    sorted_times = sorted(sample["enterToPromptMs"] for sample in samples)
    median = sorted_times[len(sorted_times) // 2]
    result = {
        "benchmark": "native-npm-terminal-pty",
        "cachePolicy": "Empty dedicated npm cache per trial; exact Pyxis package.json and package-lock.json copied before timing.",
        "command": fixture["command"],
        "manifest": manifest,
        "fixtureSha256": {"packageJson": manifest_hash, "packageLock": lockfile_hash},
        "fixtureBytes": {
            "packageJson": len(manifest_text.encode()),
            "packageLock": len(lockfile_text.encode()) if lockfile_text else 0,
        },
        "lockfileVersion": lockfile.get("lockfileVersion") if lockfile else None,
        "trialCount": args.trials,
        "medianEnterToPromptMs": median,
        "timingsMs": sorted_times,
        "trials": samples,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"medianEnterToPromptMs": median, "timingsMs": sorted_times, "output": str(args.output)}))


if __name__ == "__main__":
    main()
