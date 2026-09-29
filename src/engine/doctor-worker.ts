/**
 * doctor's checks, off the engine's thread (D62). They block for seconds, and
 * one of them asks the control panel's door for /health, which the panel
 * answers by asking the engine: on the engine's own thread, that waited for
 * itself until the check timed out, and the panel showed as a problem.
 */
import { parentPort } from "node:worker_threads";
import { checks } from "../commands/doctor.js";

parentPort?.postMessage(checks());
