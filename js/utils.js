window.formatCurrency = function(value) {
  if (value == null || isNaN(value)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

window.formatPercent = function(value, decimals) {
  if (decimals === undefined) decimals = 1;
  if (value == null || isNaN(value)) return '0.0%';
  return (value * 100).toFixed(decimals) + '%';
};

// Format number with commas for input display
window.formatNumberWithCommas = function(num) {
  if (num === null || num === undefined || num === '' || isNaN(num) || num === 0) return '';
  return Number(num).toLocaleString('en-US', { maximumFractionDigits: 0 });
};

// Parse string with commas back to number
window.parseNumberInput = function(str) {
  if (!str) return 0;
  var cleaned = String(str).replace(/,/g, '');
  var num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
};

// Haversine distance between two lat/lng points in miles
window.haversineDistanceMiles = function(lat1, lng1, lat2, lng2) {
  var R = 3959; // Earth radius in miles
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};
