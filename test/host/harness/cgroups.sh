#!/bin/sh
# Test host only (D80). Never part of the suite.
#
# On a real machine, systemd's cgroup is the real root: processes may live
# there, and the controllers for the cgroups below it (pids, memory, ...) are
# always enabled. The test host's root is a cgroup inside the workstation's
# Docker, where the kernel refuses to enable controllers for the children of a
# cgroup that holds processes of its own. A `docker exec` joins that root; one
# that arrives while the test host boots (a shell kept open on the container,
# or the harness's own look at systemd) keeps the controllers off, and no
# container with a limit on processes or memory can start: the control
# panel's did not (the eighth brief, item 1).
#
# So, before containerd and Docker start: move whatever entered the root into
# init.scope, where runc puts every later exec once the controllers are on,
# and enable the controllers systemd enables on a machine. Says what it did.
root=/sys/fs/cgroup
want="+cpuset +cpu +io +memory +pids"
tries=0
while :; do
  moved=""
  for pid in $(cat "$root/cgroup.procs"); do
    comm=$(cat "/proc/$pid/comm" 2>/dev/null || echo gone)
    if echo "$pid" > "$root/init.scope/cgroup.procs" 2>/dev/null; then moved="$moved $pid($comm)"; fi
  done
  [ -n "$moved" ] && echo "moved out of the root cgroup, into init.scope:$moved"
  if echo "$want" > "$root/cgroup.subtree_control" 2>/dev/null; then break; fi
  tries=$((tries + 1))
  if [ "$tries" -ge 50 ]; then
    echo "the root cgroup's controllers could not be enabled: $(cat "$root/cgroup.procs" | tr '\n' ' ')" >&2
    exit 1
  fi
  sleep 0.1
done
echo "the root cgroup gives its children: $(cat "$root/cgroup.subtree_control")"
