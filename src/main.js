// Einstiegspunkt. Reihenfolge ist wichtig: erst die Bruecke, die die Handler-Namen
// auf window legt, dann init — sonst laufen die ersten Klicks ins Leere, weil das
// erzeugte HTML seine onclick-Ziele noch nicht findet.
import './app/globals.js';
import './app/init.js';
