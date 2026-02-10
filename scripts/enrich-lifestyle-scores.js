#!/usr/bin/env node
/**
 * Enrich neighborhood data with lifestyle scores (schools, safety, walkability).
 *
 * Generates heuristic-based 1-10 scores using region, median price, and known
 * city characteristics. These are reasonable estimates — replace with real API
 * data (GreatSchools, Walk Score, FBI UCR) when available.
 *
 * Usage: node scripts/enrich-lifestyle-scores.js
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'js', 'neighborhood-data.js');

// ── Known city-level overrides ──────────────────────────────────────────────
// These override heuristic scores for cities with well-known characteristics.
// Format: { schoolScore, safetyScore, walkScore } — null means use heuristic.

const CITY_OVERRIDES = {
  // Top school districts
  'Irvine':            { schoolScore: 9, safetyScore: 9, walkScore: 6 },
  'San Marino':        { schoolScore: 10, safetyScore: 9, walkScore: 6 },
  'Arcadia':           { schoolScore: 9, safetyScore: 8, walkScore: 6 },
  'La Canada Flintridge': { schoolScore: 9, safetyScore: 9, walkScore: 4 },
  'Walnut':            { schoolScore: 8, safetyScore: 8, walkScore: 4 },
  'Diamond Bar':       { schoolScore: 8, safetyScore: 8, walkScore: 3 },
  'Yorba Linda':       { schoolScore: 8, safetyScore: 9, walkScore: 3 },
  'Mission Viejo':     { schoolScore: 8, safetyScore: 9, walkScore: 4 },
  'Lake Forest':       { schoolScore: 8, safetyScore: 8, walkScore: 4 },
  'Rancho Santa Margarita': { schoolScore: 8, safetyScore: 9, walkScore: 3 },
  'San Clemente':      { schoolScore: 7, safetyScore: 8, walkScore: 5 },
  'Laguna Niguel':     { schoolScore: 8, safetyScore: 9, walkScore: 4 },
  'Aliso Viejo':       { schoolScore: 8, safetyScore: 9, walkScore: 5 },
  'Newport Beach':     { schoolScore: 8, safetyScore: 8, walkScore: 6 },
  'Calabasas':         { schoolScore: 8, safetyScore: 8, walkScore: 3 },
  'Manhattan Beach':   { schoolScore: 9, safetyScore: 8, walkScore: 7 },
  'Palos Verdes Estates': { schoolScore: 9, safetyScore: 9, walkScore: 3 },
  'Rancho Palos Verdes': { schoolScore: 8, safetyScore: 9, walkScore: 3 },
  'South Pasadena':    { schoolScore: 8, safetyScore: 7, walkScore: 7 },
  'Claremont':         { schoolScore: 8, safetyScore: 7, walkScore: 5 },
  'La Verne':          { schoolScore: 7, safetyScore: 7, walkScore: 4 },
  'Poway':             { schoolScore: 8, safetyScore: 8, walkScore: 3 },
  'Coronado':          { schoolScore: 8, safetyScore: 8, walkScore: 8 },
  'Encinitas':         { schoolScore: 7, safetyScore: 8, walkScore: 5 },
  'Del Mar':           { schoolScore: 8, safetyScore: 9, walkScore: 6 },
  'La Jolla':          { schoolScore: 8, safetyScore: 8, walkScore: 6 },
  'Carlsbad':          { schoolScore: 8, safetyScore: 8, walkScore: 4 },

  // Walkable urban areas
  'Santa Monica':      { schoolScore: 7, safetyScore: 5, walkScore: 9 },
  'Pasadena':          { schoolScore: 6, safetyScore: 6, walkScore: 8 },
  'Long Beach':        { schoolScore: 5, safetyScore: 5, walkScore: 7 },
  'Burbank':           { schoolScore: 6, safetyScore: 7, walkScore: 7 },
  'Glendale':          { schoolScore: 6, safetyScore: 7, walkScore: 7 },
  'Culver City':       { schoolScore: 6, safetyScore: 6, walkScore: 7 },
  'West Hollywood':    { schoolScore: 5, safetyScore: 5, walkScore: 9 },
  'Beverly Hills':     { schoolScore: 8, safetyScore: 7, walkScore: 8 },
  'Hermosa Beach':     { schoolScore: 7, safetyScore: 7, walkScore: 8 },
  'Redondo Beach':     { schoolScore: 7, safetyScore: 7, walkScore: 7 },
  'Huntington Beach':  { schoolScore: 7, safetyScore: 7, walkScore: 5 },
  'Fullerton':         { schoolScore: 6, safetyScore: 6, walkScore: 6 },
  'Orange':            { schoolScore: 7, safetyScore: 7, walkScore: 5 },
  'San Diego':         { schoolScore: 6, safetyScore: 6, walkScore: 6 },

  // Lower-performing areas (honest assessment)
  'Compton':           { schoolScore: 3, safetyScore: 3, walkScore: 6 },
  'San Bernardino':    { schoolScore: 3, safetyScore: 3, walkScore: 5 },
  'Adelanto':          { schoolScore: 3, safetyScore: 4, walkScore: 2 },
  'Victorville':       { schoolScore: 3, safetyScore: 4, walkScore: 3 },
  'Hesperia':          { schoolScore: 4, safetyScore: 4, walkScore: 2 },
  'Barstow':           { schoolScore: 3, safetyScore: 3, walkScore: 3 },
  'Palmdale':          { schoolScore: 4, safetyScore: 4, walkScore: 3 },
  'Lancaster':         { schoolScore: 4, safetyScore: 4, walkScore: 3 },
  'Hemet':             { schoolScore: 4, safetyScore: 4, walkScore: 4 },
  'Perris':            { schoolScore: 3, safetyScore: 4, walkScore: 2 },
  'Moreno Valley':     { schoolScore: 4, safetyScore: 4, walkScore: 3 },
  'Rialto':            { schoolScore: 4, safetyScore: 4, walkScore: 4 },
  'Fontana':           { schoolScore: 4, safetyScore: 5, walkScore: 3 },
  'Pomona':            { schoolScore: 4, safetyScore: 4, walkScore: 5 },
  'El Monte':          { schoolScore: 4, safetyScore: 5, walkScore: 6 },
  'Inglewood':         { schoolScore: 4, safetyScore: 4, walkScore: 6 },
  'Lynwood':           { schoolScore: 3, safetyScore: 3, walkScore: 6 },
  'Hawthorne':         { schoolScore: 4, safetyScore: 5, walkScore: 6 },
  'Watts':             { schoolScore: 3, safetyScore: 2, walkScore: 5 },

  // Mid-tier suburban
  'Riverside':         { schoolScore: 5, safetyScore: 5, walkScore: 4 },
  'Corona':            { schoolScore: 6, safetyScore: 7, walkScore: 3 },
  'Chino Hills':       { schoolScore: 7, safetyScore: 8, walkScore: 3 },
  'Chino':             { schoolScore: 5, safetyScore: 6, walkScore: 4 },
  'Ontario':           { schoolScore: 5, safetyScore: 5, walkScore: 4 },
  'Rancho Cucamonga':  { schoolScore: 7, safetyScore: 7, walkScore: 4 },
  'Upland':            { schoolScore: 6, safetyScore: 6, walkScore: 5 },
  'Glendora':          { schoolScore: 7, safetyScore: 7, walkScore: 4 },
  'Azusa':             { schoolScore: 5, safetyScore: 5, walkScore: 5 },
  'Covina':            { schoolScore: 5, safetyScore: 6, walkScore: 5 },
  'West Covina':       { schoolScore: 6, safetyScore: 6, walkScore: 4 },
  'Monrovia':          { schoolScore: 6, safetyScore: 6, walkScore: 6 },
  'Alhambra':          { schoolScore: 6, safetyScore: 6, walkScore: 7 },
  'Whittier':          { schoolScore: 6, safetyScore: 6, walkScore: 5 },
  'Downey':            { schoolScore: 5, safetyScore: 6, walkScore: 5 },
  'Cerritos':          { schoolScore: 8, safetyScore: 8, walkScore: 4 },
  'Torrance':          { schoolScore: 7, safetyScore: 7, walkScore: 6 },
  'Gardena':           { schoolScore: 4, safetyScore: 5, walkScore: 6 },
  'Carson':            { schoolScore: 5, safetyScore: 5, walkScore: 4 },
  'Lakewood':          { schoolScore: 6, safetyScore: 6, walkScore: 4 },
  'Norwalk':           { schoolScore: 5, safetyScore: 5, walkScore: 4 },
  'La Mirada':         { schoolScore: 6, safetyScore: 7, walkScore: 4 },
  'Brea':              { schoolScore: 7, safetyScore: 8, walkScore: 5 },
  'Placentia':         { schoolScore: 7, safetyScore: 7, walkScore: 4 },
  'Anaheim':           { schoolScore: 5, safetyScore: 5, walkScore: 5 },
  'Santa Ana':         { schoolScore: 4, safetyScore: 4, walkScore: 6 },
  'Costa Mesa':        { schoolScore: 6, safetyScore: 6, walkScore: 6 },
  'Garden Grove':      { schoolScore: 5, safetyScore: 6, walkScore: 5 },
  'Westminster':       { schoolScore: 5, safetyScore: 6, walkScore: 5 },
  'Tustin':            { schoolScore: 7, safetyScore: 7, walkScore: 5 },
  'Temecula':          { schoolScore: 7, safetyScore: 7, walkScore: 3 },
  'Murrieta':          { schoolScore: 7, safetyScore: 8, walkScore: 3 },
  'Oceanside':         { schoolScore: 5, safetyScore: 6, walkScore: 5 },
  'Vista':             { schoolScore: 5, safetyScore: 6, walkScore: 4 },
  'Escondido':         { schoolScore: 5, safetyScore: 5, walkScore: 5 },
  'El Cajon':          { schoolScore: 4, safetyScore: 4, walkScore: 5 },
  'Chula Vista':       { schoolScore: 5, safetyScore: 6, walkScore: 4 },
  'National City':     { schoolScore: 4, safetyScore: 4, walkScore: 6 },
  'Santee':            { schoolScore: 6, safetyScore: 7, walkScore: 3 },
  'San Marcos':        { schoolScore: 6, safetyScore: 7, walkScore: 4 },

  // Rural/remote
  'Twentynine Palms': { schoolScore: 3, safetyScore: 5, walkScore: 2 },
  'Joshua Tree':      { schoolScore: 4, safetyScore: 5, walkScore: 2 },
  'Yucca Valley':     { schoolScore: 4, safetyScore: 5, walkScore: 3 },
  'Big Bear Lake':    { schoolScore: 5, safetyScore: 7, walkScore: 4 },
  'Wrightwood':       { schoolScore: 5, safetyScore: 7, walkScore: 2 },
  'Aguanga':           { schoolScore: 3, safetyScore: 5, walkScore: 1 },
  'Anza':              { schoolScore: 3, safetyScore: 5, walkScore: 1 },
};

// ── Region-based baselines ──────────────────────────────────────────────────
const REGION_BASELINES = {
  'SoCal - OC':    { schoolScore: 7, safetyScore: 7, walkScore: 4 },
  'SoCal - LA':    { schoolScore: 5, safetyScore: 5, walkScore: 6 },
  'Inland Empire':  { schoolScore: 5, safetyScore: 5, walkScore: 3 },
  'SoCal - SD':    { schoolScore: 6, safetyScore: 6, walkScore: 4 },
};

// ── Heuristic score generation ──────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

/**
 * Generate heuristic scores based on region + price level.
 * Higher median prices within a region generally correlate with
 * better schools, lower crime, and (sometimes) better walkability.
 */
function generateScores(entry, allEntries) {
  // Check for city-level override first
  var override = CITY_OVERRIDES[entry.city] || CITY_OVERRIDES[entry.name];
  if (override) {
    return {
      schoolScore: override.schoolScore,
      safetyScore: override.safetyScore,
      walkScore: override.walkScore,
    };
  }

  // Get baseline from region
  var baseline = REGION_BASELINES[entry.region] || { schoolScore: 5, safetyScore: 5, walkScore: 4 };

  // Calculate price percentile within region for adjustment
  var regionEntries = allEntries.filter(function(e) { return e.region === entry.region; });
  var prices = regionEntries.map(function(e) { return e.medianPrice; }).sort(function(a, b) { return a - b; });
  var rank = prices.indexOf(entry.medianPrice);
  if (rank === -1) rank = prices.length / 2;
  var percentile = rank / Math.max(prices.length - 1, 1); // 0 to 1

  // Price-based adjustment: -2 to +2 from baseline
  var priceAdj = (percentile - 0.5) * 4;

  // Schools and safety correlate strongly with price
  var schoolScore = clamp(baseline.schoolScore + priceAdj, 1, 10);
  var safetyScore = clamp(baseline.safetyScore + priceAdj, 1, 10);

  // Walkability: higher-priced areas in urban regions tend to be more walkable,
  // but in suburbs, expensive means more spread out
  var walkAdj = entry.region === 'SoCal - LA' ? priceAdj * 0.5 : priceAdj * -0.3;
  var walkScore = clamp(baseline.walkScore + walkAdj, 1, 10);

  return { schoolScore: schoolScore, safetyScore: safetyScore, walkScore: walkScore };
}

// ── Main ────────────────────────────────────────────────────────────────────

var raw = fs.readFileSync(DATA_FILE, 'utf8');

// Extract the array from the JS file
var arrayMatch = raw.match(/window\.CA_NEIGHBORHOODS\s*=\s*(\[[\s\S]*\]);?\s*$/);
if (!arrayMatch) {
  console.error('Could not parse CA_NEIGHBORHOODS from data file');
  process.exit(1);
}

var neighborhoods;
try {
  neighborhoods = JSON.parse(arrayMatch[1]);
} catch (e) {
  // Try eval as fallback for JS-style comments/trailing commas
  neighborhoods = eval('(' + arrayMatch[1] + ')');
}

console.log('Loaded ' + neighborhoods.length + ' neighborhoods');

// Generate scores for all entries
var enriched = neighborhoods.map(function(entry) {
  var scores = generateScores(entry, neighborhoods);
  // Remove old scores if re-running
  var result = Object.assign({}, entry);
  result.schoolScore = scores.schoolScore;
  result.safetyScore = scores.safetyScore;
  result.walkScore = scores.walkScore;
  return result;
});

// Count overrides vs heuristic
var overrideCount = enriched.filter(function(e) {
  return CITY_OVERRIDES[e.city] || CITY_OVERRIDES[e.name];
}).length;
console.log('City overrides applied: ' + overrideCount);
console.log('Heuristic scores generated: ' + (enriched.length - overrideCount));

// Write back to file
var header = [
  '// California neighborhood market data from Zillow (December 2025)',
  '// Data keyed by zipcode for easy updates from Zillow ZHVI/ZORI',
  '// Counties: Los Angeles County, Orange County, Riverside County, San Bernardino County, San Diego County',
  '// Lifestyle scores: schoolScore, safetyScore, walkScore (1-10, heuristic-based estimates)',
  '// Total: ' + enriched.length + ' zipcodes',
].join('\n');

var output = header + '\nwindow.CA_NEIGHBORHOODS = ' + JSON.stringify(enriched, null, 2) + ';\n';
fs.writeFileSync(DATA_FILE, output, 'utf8');
console.log('Written enriched data to ' + DATA_FILE);
