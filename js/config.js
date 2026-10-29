/* Lectern — site settings you may edit.
   publicUrl: the web address where this folder is published (e.g. https://golectern.github.io/).
   Phones use it for the QR codes when you open the hub straight from your disk.
   peerServer: leave null to use the free public PeerJS server. */
window.Hub = window.Hub || {};
window.Hub.CONFIG = {
  publicUrl: 'https://golectern.github.io/',
  peerServer: null,
  // Teacher lock: a scrambled (PBKDF2) form of your teacher passcode. Devices that haven't been unlocked
  // with the passcode only see the "join a session" page. Remove this line to switch the lock off.
  teacherHash: 'de2f7dbfcd1e236457ccd1db7a0844adb6c63ecc5399950d980bdf612da43f76',
  // Relay (TURN) server from metered.ca — used when a phone can't reach the laptop directly
  // (mobile data, university Wi-Fi). Credentials come from your Metered dashboard.
  turn: { username: 'ce36927fd489c3e96cd2ffa9', credential: 'zEw2qQ47ZndlaDDh', host: 'global.relay.metered.ca' },
};
