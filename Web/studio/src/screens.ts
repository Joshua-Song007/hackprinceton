// Which full-window screen Studio shows. The editor is always mounted underneath (dockview needs a measured host);
// login and projects are overlays on top of it.
export type Screen = 'login' | 'projects' | 'editor';

export function nextScreen(signedIn: boolean, hasProject: boolean, testPlayer = false): Screen {
  if (testPlayer) return 'editor'; // a test-player tab signs itself in
  if (!signedIn) return 'login';
  return hasProject ? 'editor' : 'projects';
}
