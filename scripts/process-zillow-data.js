#!/usr/bin/env node
/**
 * Process Zillow ZHVI and ZORI data to generate neighborhood-data.js
 *
 * Usage: node scripts/process-zillow-data.js
 */

const fs = require('fs');
const path = require('path');

// Counties to include
const TARGET_COUNTIES = [
  'Los Angeles County',
  'Orange County',
  'Riverside County',
  'San Bernardino County',
  'San Diego County',
];

// Region mapping by county
const COUNTY_REGIONS = {
  'Los Angeles County': 'SoCal - LA',
  'Orange County': 'SoCal - OC',
  'Riverside County': 'Inland Empire',
  'San Bernardino County': 'Inland Empire',
  'San Diego County': 'SoCal - SD',
};

// Property tax rates by county
const COUNTY_TAX_RATES = {
  'Los Angeles County': 1.16,
  'Orange County': 1.08,
  'Riverside County': 1.25,
  'San Bernardino County': 1.28,
  'San Diego County': 1.13,
};

// Default vacancy rates by county
const COUNTY_VACANCY = {
  'Los Angeles County': 4,
  'Orange County': 3,
  'Riverside County': 5,
  'San Bernardino County': 6,
  'San Diego County': 4,
};

// Parse CSV
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    data.push(row);
  }

  return { headers, data };
}

// Get the latest non-empty value from date columns
function getLatestValue(row, headers) {
  const dateColumns = headers.filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h)).sort().reverse();
  for (const col of dateColumns) {
    const val = parseFloat(row[col]);
    if (!isNaN(val) && val > 0) {
      return { value: Math.round(val), date: col };
    }
  }
  return null;
}

// Get value from 1 year ago
function getYearAgoValue(row, headers, latestDate) {
  if (!latestDate) return null;
  const [year, month, day] = latestDate.split('-');
  const yearAgo = `${parseInt(year) - 1}-${month}-${day}`;
  const val = parseFloat(row[yearAgo]);
  if (!isNaN(val) && val > 0) return val;
  return null;
}

// Main
function main() {
  const dataDir = path.join(__dirname, '..', 'data');
  const zhviPath = path.join(dataDir, 'zhvi.csv');
  const zoriPath = path.join(dataDir, 'zori.csv');

  console.log('Reading ZHVI data...');
  const zhviContent = fs.readFileSync(zhviPath, 'utf-8');
  const zhvi = parseCSV(zhviContent);

  console.log('Reading ZORI data...');
  const zoriContent = fs.readFileSync(zoriPath, 'utf-8');
  const zori = parseCSV(zoriContent);

  // Filter for California and target counties
  const caZhvi = zhvi.data.filter(row =>
    row.State === 'CA' && TARGET_COUNTIES.includes(row.CountyName)
  );

  const caZori = zori.data.filter(row => row.State === 'CA');

  console.log(`Found ${caZhvi.length} zipcodes in target counties`);

  // Index ZORI by zipcode
  const zoriByZip = {};
  caZori.forEach(row => {
    zoriByZip[row.RegionName] = row;
  });

  // Process all zipcodes
  const neighborhoods = [];

  for (const zhviRow of caZhvi) {
    const zip = zhviRow.RegionName;
    const zoriRow = zoriByZip[zip];

    const priceData = getLatestValue(zhviRow, zhvi.headers);
    if (!priceData) continue; // Skip if no price data

    const rentData = zoriRow ? getLatestValue(zoriRow, zori.headers) : null;

    // Calculate appreciation rate
    let appreciationRate = 2; // default
    if (priceData) {
      const yearAgoPrice = getYearAgoValue(zhviRow, zhvi.headers, priceData.date);
      if (yearAgoPrice) {
        appreciationRate = ((priceData.value / yearAgoPrice) - 1) * 100;
        appreciationRate = Math.round(appreciationRate * 10) / 10;
      }
    }

    const county = zhviRow.CountyName;
    const city = zhviRow.City || 'Unknown';
    const region = COUNTY_REGIONS[county] || 'SoCal';
    const taxRate = COUNTY_TAX_RATES[county] || 1.16;
    const vacancyRate = COUNTY_VACANCY[county] || 5;
    const insurance = Math.round(priceData.value * 0.0035);
    const rent = rentData ? Math.round(rentData.value) : 0;

    neighborhoods.push({
      zipcode: zip,
      name: city,
      city: city,
      region: region,
      medianPrice: priceData.value,
      expectedRent: rent,
      propertyTaxRate: taxRate,
      monthlyHOA: 0,
      annualInsurance: insurance,
      vacancyRate: vacancyRate,
      maintenanceRate: 1,
      managementFee: 0,
      appreciationRate: appreciationRate,
      currentRentIfBuying: rent ? Math.round(rent * 0.85) : 0,
    });
  }

  // Sort by region, then city, then zipcode
  neighborhoods.sort((a, b) => {
    if (a.region !== b.region) return a.region.localeCompare(b.region);
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.zipcode.localeCompare(b.zipcode);
  });

  console.log(`\nProcessed ${neighborhoods.length} neighborhoods`);
  console.log(`  With rent data: ${neighborhoods.filter(n => n.expectedRent > 0).length}`);
  console.log(`  Without rent data: ${neighborhoods.filter(n => n.expectedRent === 0).length}`);

  // Group by region for stats
  const byRegion = {};
  neighborhoods.forEach(n => {
    byRegion[n.region] = byRegion[n.region] || [];
    byRegion[n.region].push(n);
  });

  console.log('\nBy region:');
  Object.keys(byRegion).sort().forEach(region => {
    console.log(`  ${region}: ${byRegion[region].length} zipcodes`);
  });

  // Generate JavaScript file
  const jsContent = `// California neighborhood market data from Zillow (December 2025)
// Data keyed by zipcode for easy updates from Zillow ZHVI/ZORI
// Counties: ${TARGET_COUNTIES.join(', ')}
// Total: ${neighborhoods.length} zipcodes
window.CA_NEIGHBORHOODS = ${JSON.stringify(neighborhoods, null, 2)};
`;

  const outputPath = path.join(__dirname, '..', 'js', 'neighborhood-data.js');
  fs.writeFileSync(outputPath, jsContent);
  console.log(`\nWritten to ${outputPath}`);
}

main();
