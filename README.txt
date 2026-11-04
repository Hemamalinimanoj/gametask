ASHEN ROADS - REAL SOUNDS
=========================
Put real recordings (.mp3 / .ogg / .wav / .m4a) in THIS folder. The game finds them by file name and plays them
instead of the built-in synthesized sound. Anything you do not provide keeps the synthesized sound.
Restart the server (or just refresh the page) after adding files.

VARIANTS: add -1, -2, -3 ... to the name (zombie-groan-1.mp3, zombie-groan-2.mp3). One is picked at random each time,
and a small random pitch change is added, so repeated sounds never feel copy-pasted.

NAMES
  gun-shot            your gun / other players' guns (already included: gun-shot.mp3)
  gun-dry             empty-magazine click
  reload              reload
  melee-swing         pipe swing in the air
  melee-hit           pipe hits a zombie
  flesh-hit           bullet hits a zombie
  bite-hit            bite lands on a zombie
  bullet-wall         bullet hits a wall / car
  bullet-ground       bullet hits the road
  zombie-groan        idle moan (heard from far away too)
  zombie-attack       zombie attack roar
  zombie-hurt         zombie hurt
  zombie-death        zombie death
  dog-bark  dog-growl  dog-bite
  player-hurt         you take damage
  heal                medkit / healing
  pickup  pickup-scrap  pickup-wood  pickup-ammo  pickup-gun    (pickup = generic)
  footstep  footstep-run                one step (the game repeats it)
  level-up  victory  game-over  start
  thunder
  zone-warning  plane  airdrop  armor  crash      (battle mode)
  ambient             LOOP: wind / night ambience (replaces the synthesized wind + drone)
  rain                LOOP: rain (its loudness still follows the weather)

TIPS
  * Mono or stereo both work. Keep one-shots short (0.2 - 3 s), loops 20 s or longer and seamless.
  * Normalise loudness roughly the same for every file; the game adds distance fading, stereo panning,
    muffling for far sounds and room reverb on its own.
  * Free sources: freesound.org, pixabay.com/sound-effects, mixkit.co/free-sound-effects, sonniss.com (GDC game audio bundles).
    Check each file's licence before you publish the game.
