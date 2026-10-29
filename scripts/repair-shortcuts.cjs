const { app, shell } = require("electron");
const fs = require("fs");
const path = require("path");

app.whenReady().then(() => {
  const desktopLink = path.join(app.getPath("desktop"), "Spotify Media Guard.lnk");
  const pinnedLink = path.join(app.getPath("appData"),
    "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar",
    "Spotify Media Guard.lnk");
  for (const shortcut of [desktopLink, pinnedLink]) {
    if (!fs.existsSync(shortcut)) continue;
    const existing = shell.readShortcutLink(shortcut);
    if (!shell.writeShortcutLink(shortcut, "update", {
      ...existing, appUserModelId: "SpotifyMediaGuard"
    })) throw new Error(`Could not update shortcut: ${shortcut}`);
    const updated = shell.readShortcutLink(shortcut);
    if (updated.appUserModelId !== "SpotifyMediaGuard") {
      throw new Error(`Shortcut identity verification failed: ${shortcut}`);
    }
    console.log(`Shortcut identity repaired: ${shortcut}`);
  }
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
