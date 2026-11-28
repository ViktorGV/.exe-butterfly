# show

Owned by #35. Multi-round elimination show: a room started through the theme vote (event mode) runs one race
per event theme (vote winner first, never repeating). The top ~60% of each round (`SHOW_KEEP`) race the next
round; the final round (2 or fewer players, or the last theme) has one qualifier, the winner. Eliminated players
stay in the room and rejoin the lobby when the show ends. `index.ts` holds the pure rules; `room/room.ts` drives them.
A room started with plain `start` stays a single race.
