// Blank template: a floor and nothing else. The New game form writes the instructions first; scripts and entities come after.
// It declares only the player count, so the simulator has no devices until the creator adds peripherals.
// Plain data: project.ts turns it into a Project.

export const blankScene = {
  name: 'Blank',
  requiredTier: 1,
  playerOrigin: [0, 1.6, 0],
  runMode: 'screen',
  inputs: { players: [1, 32] },
  clientScripts: [] as string[],
  serverScripts: [] as string[],
  entities: [
    { name: 'Floor', position: [0, 0, -4], scale: [10, 0.1, 10] },
  ],
};

export const blankClientScripts: Record<string, string> = {};

export const blankServerScripts: Record<string, string> = {};
