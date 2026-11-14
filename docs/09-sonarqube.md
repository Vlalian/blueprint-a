# SonarQube at work

The SonarQube gate and adapter shipped in v0.5 were retired in ticket 95 and are not part of
v1.0.0. Their source remains available in the v0.9.0 release and the reference archive.

A team may keep its own SonarQube pipeline alongside these gates. Decide at work which edition,
quality gate and branch policies apply, and bind any reported verdict to the exact head commit.
The Blueprint A supply-chain, security, test-strength and CI gates remain independent checks.
