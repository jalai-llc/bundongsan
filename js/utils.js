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
