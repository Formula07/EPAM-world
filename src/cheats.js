import { LAPTOP_IDS } from './weapons.js';

// Type these during gameplay (no need to open anything), GTA style.
export const CHEATS = [
  { code: 'HESOYAM', desc: 'Health, armor and $250,000', run: g => { g.player.heal(); g.player.armor = 100; g.player.addMoney(250000); } },
  { code: 'EPAMRICH', desc: '+$1,000,000 bonus', run: g => g.player.addMoney(1000000) },
  { code: 'LAWYERUP', desc: 'Clear wanted level', run: g => { g.police.clear(); g.onWantedCleared(); } },
  { code: 'MOSTWANTED', desc: 'Five-star wanted level', run: g => g.police.setLevel(5) },
  { code: 'CABME', desc: 'Spawn an EPAM Cab', run: g => g.spawnNearPlayer('cab') },
  { code: 'BIKEME', desc: 'Spawn an EPAM Bike', run: g => g.spawnNearPlayer('bike') },
  { code: 'TANKME', desc: 'Spawn an EPAM Security Tank', run: g => g.spawnNearPlayer('tank') },
  { code: 'COPCAR', desc: 'Spawn an EPAM Police Cruiser', run: g => g.spawnNearPlayer('police') },
  { code: 'LAPTOPS', desc: 'All laptop weapons', run: g => LAPTOP_IDS.forEach(id => g.player.giveWeapon(id)) },
  { code: 'GODMODE', desc: 'Toggle invincibility', toggle: 'god' },
  { code: 'MOONJUMP', desc: 'Toggle super jump', toggle: 'moonJump' },
  { code: 'ESPRESSO', desc: 'Toggle super sprint', toggle: 'fastRun' },
];

export class Cheats {
  constructor(game) {
    this.game = game;
    this.buffer = '';
  }

  // fed with KeyboardEvent.code values while playing
  onKey(code) {
    if (!/^Key[A-Z]$/.test(code)) return;
    this.buffer = (this.buffer + code[3]).slice(-12);
    const cheat = CHEATS.find(c => this.buffer.endsWith(c.code));
    if (!cheat) return;
    this.buffer = '';
    const game = this.game;
    let label = cheat.desc;
    if (cheat.toggle) {
      const flags = game.player.cheats;
      flags[cheat.toggle] = !flags[cheat.toggle];
      label = `${cheat.desc.replace('Toggle ', '')}: ${flags[cheat.toggle] ? 'ON' : 'OFF'}`;
    } else {
      cheat.run(game);
    }
    game.hud.toast(`CHEAT ACTIVATED — ${label}`, 'cheat');
    game.sfx.cheat();
  }
}
