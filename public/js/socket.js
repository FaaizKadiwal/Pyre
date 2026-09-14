// Single Socket.IO connection shared by the whole client.
// `io` is provided by /socket.io/socket.io.js, served by the game server.

export const socket = io();

/**
 * Send a request and resolve with the server's `{ ok, ... }` acknowledgement.
 * Never rejects: a timeout or transport failure becomes `{ ok: false, error }`.
 */
export function request(event, payload = {}, timeoutMs = 5000) {
    return new Promise((resolve) => {
        socket.timeout(timeoutMs).emit(event, payload, (err, response) => {
            if (err) {
                resolve({ ok: false, error: 'The server did not respond. Please try again.' });
            } else {
                resolve(response ?? { ok: false, error: 'Empty response from server' });
            }
        });
    });
}
