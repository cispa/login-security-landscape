import { spawn } from "child_process";

type CallbackFunction = (stdout: string, stderr: string, code: number | null) => Promise<void>;
type OnProcessKilledFunction = (code: number | null) => void;
type onErrorFunction = (error: unknown) => void;

/**
 * Run a command promisified and capture output, run appropriate callback functions on successful termination/error/early termination due to
 * kill-timeout.
 * 
 * @param command Command to run
 * @param args Arguments for the command
 * @param callback Callback function to execute after command has been successfully executed
 * @param killTimeout Timeout after which process is killed
 * @param onProcessorKilled Callback function executed after process was killed
 * @param onError Callback function after script exited due to error
 * @returns 
 */
const run_script = async (command: string, args: ReadonlyArray<string>, callback: CallbackFunction, killTimeout: number, onProcessorKilled: OnProcessKilledFunction, onError: onErrorFunction) => {
    return await new Promise((resolve) => {
        try {
            // Spawn the child process
            const child = spawn(command, args);

            let stdout = "";
            let stderr = "";

            // Set encoding for stdout and capture into string
            child.stdout.setEncoding('utf8');
            child.stdout.on('data', function (data) {
                data = data.toString();
                stdout += data;
            });

            // Set encoding for stderr and capture into string
            child.stderr.setEncoding('utf8');
            child.stderr.on('data', function (data) {
                data = data.toString();
                stderr += data;
            });
            let killed = false;

            // Set timeout to kill process after killTimeout time
            const timeout = setTimeout(() => {
                killed = true;
                child.kill('SIGINT');
                // Resolve with false to indicate error
                resolve(false);
            }, killTimeout);

            // On child process close, clear timeout to kill process
            child.on('close', async function (code) {
                clearTimeout(timeout);
                // Check if process closed because it was killed
                if (killed) {
                    // If it was killed, run onProcessorKilled callback
                    onProcessorKilled(code);
                    // Resolve with false to indicate error
                    resolve(false);
                } else {
                    // If it was not killed, run call back function (which can be asynchronous)
                    await callback(stdout, stderr, code);
                    // Resolve with true to indicate success
                    resolve(true);
                }
            });
        } catch (error: unknown) {
            // If any error happened during process running, run onError callback
            onError(error);
            // Resolve with false to indicate error
            resolve(false);
        }
    })

}

export { run_script }