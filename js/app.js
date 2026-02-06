document.addEventListener('alpine:init', function() {
  var F = window.Formulas;
  var D = window.CA_DEFAULTS;

  Alpine.data('nestready', function() {
    return {
      // ── Financial Inputs (persisted) ──────────────────────────
      grossAnnualIncome: Alpine.$persist(0).as('fin_grossAnnualIncome'),
      monthlyDebts: Alpine.$persist(0).as('fin_monthlyDebts'),
      currentRent: Alpine.$persist(0).as('fin_currentRent'),
      otherExpenses: Alpine.$persist(0).as('fin_otherExpenses'),
      savingsAvailable: Alpine.$persist(0).as('fin_savings'),
      monthlySavings: Alpine.$persist(0).as('fin_monthlySavings'),
      effectiveTaxRate: Alpine.$persist(35).as('fin_effectiveTaxRate'),

      // Comfort level (conservative, standard, aggressive)
      comfortLevel: Alpine.$persist('standard').as('fin_comfortLevel'),

      // Loan preferences
      interestRate: Alpine.$persist(6.75).as('fin_interestRate'),
      loanTermYears: Alpine.$persist(30).as('fin_loanTerm'),
      downPaymentPercent: Alpine.$persist(20).as('fin_downPaymentPct'),
      propertyTaxRate: Alpine.$persist(1.25).as('fin_taxRate'),
      closingCostRate: Alpine.$persist(3).as('fin_closingCostRate'),
      isHighCostCounty: Alpine.$persist(true).as('fin_highCost'),

      // ── Buying Power (computed) ───────────────────────────────
      get grossMonthlyIncome() {
        return this.grossAnnualIncome / 12;
      },

      get netMonthlyIncome() {
        return this.grossMonthlyIncome * (1 - this.effectiveTaxRate / 100);
      },

      get comfortConfig() {
        return window.COMFORT_LEVELS[this.comfortLevel] || window.COMFORT_LEVELS.standard;
      },

      get conformingLimit() {
        return this.isHighCostCounty ? D.conformingLoanLimitHighCost : D.conformingLoanLimit;
      },

      // ── Constraint Calculations ──────────────────────────────
      // Cash constraint: savings must cover down payment + closing
      get maxPriceByCash() {
        var dpPct = this.downPaymentPercent / 100;
        var ccPct = this.closingCostRate / 100;
        var cashDenom = dpPct + ccPct;
        return cashDenom > 0 ? Math.floor(this.savingsAvailable / cashDenom) : 0;
      },

      // Income/DTI constraint: max price based on what monthly payment you can afford
      get maxPriceByIncome() {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;

        var dpPct = this.downPaymentPercent / 100;
        var rate = this.interestRate / 100;
        var taxRate = this.propertyTaxRate / 100;
        var insRate = D.homeownersInsuranceRate;
        var comfort = this.comfortConfig;

        // DTI constraints using comfort level settings
        var maxHousingFront = grossMonthly * comfort.frontEndDTI;
        var maxHousingBack = grossMonthly * comfort.backEndDTI - this.monthlyDebts;

        // Budget constraint: income - debts - other expenses - buffer
        var buffer = grossMonthly * comfort.bufferRate;
        var maxHousingBudget = grossMonthly - this.monthlyDebts - this.otherExpenses - buffer;

        // Take the most restrictive of all three
        var maxMonthlyHousing = Math.min(maxHousingFront, maxHousingBack, maxHousingBudget);
        if (maxMonthlyHousing <= 0) return 0;

        // Binary search for max price given the housing budget
        var lo = 0, hi = 5000000;
        for (var i = 0; i < 50; i++) {
          var mid = (lo + hi) / 2;
          var loan = mid * (1 - dpPct);
          if (loan <= 0) { lo = mid; continue; }
          var piti = F.monthlyPITI(loan, rate, this.loanTermYears, mid * taxRate, mid * insRate);
          var ltv = mid > 0 ? loan / mid : 0;
          var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;
          if (piti.total + pmi < maxMonthlyHousing) lo = mid;
          else hi = mid;
        }
        return Math.floor(lo);
      },

      // Final max affordable price = minimum of both constraints
      get maxAffordablePrice() {
        return Math.min(this.maxPriceByCash, this.maxPriceByIncome);
      },

      // Which constraint is limiting?
      get limitingConstraint() {
        if (this.grossMonthlyIncome <= 0) return null;
        return this.maxPriceByCash <= this.maxPriceByIncome ? 'cash' : 'income';
      },

      get monthlyHousingBudget() {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;
        var comfort = this.comfortConfig;

        var frontEnd = grossMonthly * comfort.frontEndDTI;
        var backEnd = grossMonthly * comfort.backEndDTI - this.monthlyDebts;
        var budgetBased = grossMonthly - this.monthlyDebts - this.otherExpenses - (grossMonthly * comfort.bufferRate);

        return Math.max(0, Math.min(frontEnd, backEnd, budgetBased));
      },

      get hasFinancials() {
        return this.grossAnnualIncome > 0 && this.savingsAvailable > 0;
      },

      // PITI breakdown at max affordable price
      get pitiAtMaxPrice() {
        var price = this.maxAffordablePrice;
        if (price <= 0) return null;

        var dpPct = this.downPaymentPercent / 100;
        var rate = this.interestRate / 100;
        var taxRate = this.propertyTaxRate / 100;
        var insRate = D.homeownersInsuranceRate;

        var downPayment = price * dpPct;
        var loan = price - downPayment;
        var piti = F.monthlyPITI(loan, rate, this.loanTermYears, price * taxRate, price * insRate);
        var ltv = price > 0 ? loan / price : 0;
        var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;

        return {
          principalInterest: piti.principal_interest,
          taxes: piti.tax,
          insurance: piti.insurance,
          pmi: pmi,
          total: piti.total + pmi,
        };
      },

      // Monthly cushion after taxes, expenses, and housing (uses NET income for realism)
      get monthlyCushion() {
        var netMonthly = this.netMonthlyIncome;
        if (netMonthly <= 0) return 0;
        var piti = this.pitiAtMaxPrice;
        var housing = piti ? piti.total : 0;
        return netMonthly - this.monthlyDebts - this.otherExpenses - housing;
      },

      // Cash needed for down payment + closing at max price
      get cashNeededAtMaxPrice() {
        var price = this.maxAffordablePrice;
        var dpPct = this.downPaymentPercent / 100;
        var ccPct = this.closingCostRate / 100;
        return price * (dpPct + ccPct);
      },

      // Months until user can afford max price
      get monthsToAfford() {
        if (this.monthlySavings <= 0) return Infinity;
        var needed = this.cashNeededAtMaxPrice;
        var have = this.savingsAvailable;
        if (have >= needed) return 0;
        return Math.ceil((needed - have) / this.monthlySavings);
      },

      // Savings progress percentage
      get savingsProgress() {
        var needed = this.cashNeededAtMaxPrice;
        if (needed <= 0) return 100;
        return Math.min(100, (this.savingsAvailable / needed) * 100);
      },

      // ── Neighborhood State (persisted) ────────────────────────
      neighborhoods: Alpine.$persist([]).as('hood_neighborhoods'),
      seededLoaded: Alpine.$persist(false).as('hood_seededLoaded'),
      sortBy: Alpine.$persist('capRate').as('hood_sortBy'),
      sortDirection: Alpine.$persist('desc').as('hood_sortDirection'),
      filterAffordable: false,
      filterRegion: '',
      filterCity: '',
      searchQuery: '',
      filterFromZipcode: '',
      filterDistanceMiles: 50,
      mode: Alpine.$persist('investment').as('hood_mode'),
      showAddForm: false,

      form: {
        zipcode: '',
        name: '',
        city: '',
        region: '',
        medianPrice: 0,
        expectedRent: 0,
        propertyTaxRate: 1.25,
        monthlyHOA: 0,
        annualInsurance: 1500,
        vacancyRate: 5,
        maintenanceRate: 1,
        managementFee: 0,
        appreciationRate: 3,
      },

      // ── Initialization ────────────────────────────────────────
      init: function() {
        var self = this;

        // Merge latest seed data into persisted neighborhoods (e.g. new appreciation fields)
        // Metrics are computed lazily in rankedNeighborhoods, not here (performance)
        if (window.CA_NEIGHBORHOODS) {
          var seededByKey = {};
          window.CA_NEIGHBORHOODS.forEach(function(data) {
            seededByKey[data.zipcode || data.name] = data;
          });

          this.neighborhoods.forEach(function(n) {
            var seedData = seededByKey[n.zipcode || n.name];
            if (seedData) {
              if (seedData.appreciation5yr !== undefined) n.appreciation5yr = seedData.appreciation5yr;
              if (seedData.appreciationRate !== undefined) n.appreciationRate = seedData.appreciationRate;
            }
          });
        }

        // Watch for zipcode changes and auto-load neighborhoods
        this.$watch('filterFromZipcode', function(newZip) {
          if (newZip && newZip.length === 5 && self.getZipCoords(newZip) && !self.seededLoaded) {
            self.loadSeededNeighborhoods();
          }
        });
      },

      // Check if user has entered a valid zipcode
      get hasValidZipcode() {
        return this.filterFromZipcode &&
               this.filterFromZipcode.length === 5 &&
               this.getZipCoords(this.filterFromZipcode);
      },

      // ── Neighborhood Methods ──────────────────────────────────
      resetForm: function() {
        this.form = {
          zipcode: '',
          name: '',
          city: '',
          region: '',
          medianPrice: 0,
          expectedRent: 0,
          propertyTaxRate: this.propertyTaxRate,
          monthlyHOA: 0,
          annualInsurance: 1500,
          vacancyRate: 5,
          maintenanceRate: 1,
          managementFee: 0,
          appreciationRate: 3,
        };
      },

      resetAll: function() {
        // Reset financial inputs
        this.grossAnnualIncome = 0;
        this.monthlyDebts = 0;
        this.currentRent = 0;
        this.otherExpenses = 0;
        this.savingsAvailable = 0;
        this.monthlySavings = 0;
        this.effectiveTaxRate = 35;
        this.comfortLevel = 'standard';
        // Reset loan preferences
        this.interestRate = 6.75;
        this.loanTermYears = 30;
        this.downPaymentPercent = 20;
        this.propertyTaxRate = 1.25;
        this.closingCostRate = 3;
        this.isHighCostCounty = true;
        // Reset filters
        this.filterFromZipcode = '';
        this.filterDistanceMiles = 50;
        this.filterAffordable = false;
        this.searchQuery = '';
      },

      addNeighborhood: function() {
        if (!this.form.city || this.form.medianPrice <= 0) return;
        // If no neighborhood name provided, use city as name
        var formData = Object.assign({}, this.form);
        if (!formData.name) formData.name = formData.city;
        var n = Object.assign({}, formData, {
          id: Date.now(),
          downPaymentPercent: this.downPaymentPercent,
          interestRate: this.interestRate,
          loanTermYears: this.loanTermYears,
          closingCostRate: this.closingCostRate,
        });
        n.metrics = this.computeMetrics(n);
        this.neighborhoods.push(n);
        this.resetForm();
        this.showAddForm = false;
      },

      removeNeighborhood: function(id) {
        this.neighborhoods = this.neighborhoods.filter(function(n) { return n.id !== id; });
      },

      loadSeededNeighborhoods: function() {
        if (!window.CA_NEIGHBORHOODS) return;
        var self = this;

        // Build lookup of seeded data by zipcode
        var seededByKey = {};
        window.CA_NEIGHBORHOODS.forEach(function(data) {
          var key = data.zipcode || data.name;
          seededByKey[key] = data;
        });

        // Update existing neighborhoods with any new fields from seed data
        this.neighborhoods.forEach(function(n) {
          var key = n.zipcode || n.name;
          var seedData = seededByKey[key];
          if (seedData) {
            // Merge new fields (like appreciation5yr) without overwriting user customizations
            Object.keys(seedData).forEach(function(field) {
              if (n[field] === undefined) {
                n[field] = seedData[field];
              }
            });
            // Always update appreciation data from latest seed
            if (seedData.appreciation5yr !== undefined) n.appreciation5yr = seedData.appreciation5yr;
            if (seedData.appreciationRate !== undefined) n.appreciationRate = seedData.appreciationRate;
          }
        });

        // Use zipcode as unique key (fall back to name for legacy data)
        var existingKeys = {};
        this.neighborhoods.forEach(function(n) {
          var key = n.zipcode || n.name;
          existingKeys[key] = true;
        });

        var counter = 0;
        window.CA_NEIGHBORHOODS.forEach(function(data) {
          var key = data.zipcode || data.name;
          if (existingKeys[key]) return;
          counter++;
          var n = Object.assign({}, data, {
            id: Date.now() + counter,
            downPaymentPercent: self.downPaymentPercent,
            interestRate: self.interestRate,
            loanTermYears: self.loanTermYears,
            closingCostRate: self.closingCostRate,
          });
          n.metrics = self.computeMetrics(n);
          self.neighborhoods.push(n);
        });

        this.seededLoaded = true;
      },

      clearSeededNeighborhoods: function() {
        // Use zipcode as unique key (fall back to name for legacy data)
        var seededKeys = {};
        if (window.CA_NEIGHBORHOODS) {
          window.CA_NEIGHBORHOODS.forEach(function(n) {
            var key = n.zipcode || n.name;
            seededKeys[key] = true;
          });
        }
        this.neighborhoods = this.neighborhoods.filter(function(n) {
          var key = n.zipcode || n.name;
          return !seededKeys[key];
        });
        this.seededLoaded = false;
      },

      recalculateAll: function() {
        var self = this;
        this.neighborhoods = this.neighborhoods.map(function(n) {
          n.downPaymentPercent = self.downPaymentPercent;
          n.interestRate = self.interestRate;
          n.loanTermYears = self.loanTermYears;
          n.closingCostRate = self.closingCostRate;
          n.metrics = self.computeMetrics(n);
          return n;
        });
      },

      computeMetrics: function(n) {
        var annualRent = n.expectedRent * 12;
        var downPayment = n.medianPrice * (n.downPaymentPercent / 100);
        var loan = n.medianPrice - downPayment;
        var annualTax = n.medianPrice * (n.propertyTaxRate / 100);
        var annualMaintenance = n.medianPrice * (n.maintenanceRate / 100);
        var annualManagement = annualRent * (n.managementFee / 100);
        var closingCosts = n.medianPrice * (n.closingCostRate / 100);
        var cashInvested = downPayment + closingCosts;

        var piti = F.monthlyPITI(loan, n.interestRate / 100, n.loanTermYears, annualTax, n.annualInsurance);
        var ltv = n.medianPrice > 0 ? loan / n.medianPrice : 0;
        var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;

        var cr = F.capRate(n.medianPrice, annualRent, n.vacancyRate / 100,
          annualTax, n.annualInsurance, annualMaintenance, (n.monthlyHOA || 0) * 12, annualManagement);

        var mCashFlow = F.monthlyCashFlow(n.expectedRent, n.vacancyRate / 100,
          piti.total, pmi, n.monthlyHOA || 0, annualMaintenance / 12, annualManagement / 12);

        var annualCashFlow = mCashFlow * 12;
        var cocReturn = F.cashOnCashReturn(annualCashFlow, cashInvested);
        var grm = F.grossRentMultiplier(n.medianPrice, annualRent);

        var monthlyCostOfOwnership = piti.total + pmi + (n.monthlyHOA || 0) + annualMaintenance / 12;
        // Compare ownership cost to user's current rent (not neighborhood market rent)
        var rentVsBuyDiff = monthlyCostOfOwnership - (this.currentRent || 0);
        // Use 5-year historical appreciation for projections (more stable than 1yr)
        var appreciation5yr = (n.appreciation5yr != null ? n.appreciation5yr : 3) / 100;
        var equityProjection = F.equityProjection(
          n.medianPrice, downPayment, loan,
          n.interestRate / 100, n.loanTermYears, appreciation5yr, 10
        );
        var totalValueProjection = F.totalValueProjection(
          n.medianPrice, downPayment, loan,
          n.interestRate / 100, n.loanTermYears, appreciation5yr, annualCashFlow, 10
        );

        // Combined Total Annual Return: leveraged appreciation (5yr) + cash-on-cash
        // This shows the power of leverage - appreciation on full home value, but only your down payment invested
        var leveragedAppreciationReturn = cashInvested > 0 ? (n.medianPrice * appreciation5yr) / cashInvested : 0;
        var totalAnnualReturn = cocReturn + leveragedAppreciationReturn;

        return {
          capRate: cr,
          cashOnCash: cocReturn,
          monthlyCashFlow: mCashFlow,
          grossRentMultiplier: grm,
          piti: piti,
          pmi: pmi,
          cashInvested: cashInvested,
          downPayment: downPayment,
          closingCosts: closingCosts,
          monthlyCostOfOwnership: monthlyCostOfOwnership,
          rentVsBuyDiff: rentVsBuyDiff,
          equityProjection: equityProjection,
          totalValueProjection: totalValueProjection,
          appreciationRate: n.appreciationRate || 3,
          appreciation5yr: n.appreciation5yr,
          leveragedAppreciationReturn: leveragedAppreciationReturn,
          totalAnnualReturn: totalAnnualReturn,
        };
      },

      // ── Affordability Check ───────────────────────────────────
      checkAffordability: function(n) {
        if (!this.hasFinancials) {
          return { affordable: null, reasons: [] };
        }

        var grossMonthly = this.grossMonthlyIncome;
        var downPayment = n.medianPrice * (n.downPaymentPercent / 100);
        var closingCosts = n.medianPrice * (n.closingCostRate / 100);
        var totalCashNeeded = downPayment + closingCosts;
        var canAffordCash = this.savingsAvailable >= totalCashNeeded;

        var loan = n.medianPrice - downPayment;
        var annualTax = n.medianPrice * (n.propertyTaxRate / 100);
        var piti = F.monthlyPITI(loan, n.interestRate / 100, n.loanTermYears, annualTax, n.annualInsurance);
        var ltv = n.medianPrice > 0 ? loan / n.medianPrice : 0;
        var pmi = ltv > 0.8 ? F.monthlyPMI(loan, D.pmiRate) : 0;
        var totalHousing = piti.total + pmi + (n.monthlyHOA || 0);
        var backEndDTI = F.backEndDTI(totalHousing, this.monthlyDebts, grossMonthly);
        var canAffordDTI = backEndDTI <= D.backEndDTIMax;

        var isJumbo = loan > this.conformingLimit;

        var reasons = [];
        if (!canAffordCash) {
          reasons.push('Need ' + formatCurrency(totalCashNeeded) + ' cash (have ' + formatCurrency(this.savingsAvailable) + ')');
        }
        if (!canAffordDTI) {
          reasons.push('DTI ' + formatPercent(backEndDTI) + ' exceeds ' + formatPercent(D.backEndDTIMax) + ' limit');
        }

        return {
          affordable: canAffordCash && canAffordDTI,
          canAffordCash: canAffordCash,
          canAffordDTI: canAffordDTI,
          totalCashNeeded: totalCashNeeded,
          cashShortfall: Math.max(0, totalCashNeeded - this.savingsAvailable),
          backEndDTI: backEndDTI,
          totalHousing: totalHousing,
          isJumbo: isJumbo,
          reasons: reasons,
        };
      },

      // ── Available Regions and Cities ──────────────────────────
      get availableRegions() {
        var regions = {};
        this.neighborhoods.forEach(function(n) {
          if (n.region) regions[n.region] = true;
        });
        return Object.keys(regions).sort();
      },

      get availableCities() {
        var self = this;
        var cities = {};
        this.neighborhoods.forEach(function(n) {
          // If region filter is set, only show cities in that region
          if (self.filterRegion && n.region !== self.filterRegion) return;
          if (n.city) cities[n.city] = true;
        });
        return Object.keys(cities).sort();
      },

      // ── Sorting & Ranking ─────────────────────────────────────
      toggleSort: function(field) {
        if (this.sortBy === field) {
          this.sortDirection = this.sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
          this.sortBy = field;
          this.sortDirection = 'desc';
        }
      },

      get rankedNeighborhoods() {
        var self = this;
        var sortBy = this.sortBy;
        var direction = this.sortDirection;
        var query = (this.searchQuery || '').toLowerCase().trim();
        var filterRegion = this.filterRegion;
        var filterCity = this.filterCity;

        // Require zipcode filter - return empty if not set (performance optimization)
        if (!self.filterFromZipcode || !window.ZIPCODE_COORDS) {
          return [];
        }
        var refCoords = self.getZipCoords(self.filterFromZipcode);
        if (!refCoords) {
          return [];  // Invalid zipcode
        }

        // Start with all neighborhoods
        var list = this.neighborhoods;

        // 1. FILTER FIRST (cheap operations on raw data)

        // Distance filter - primary filter
        var maxDist = self.filterDistanceMiles;
        list = list.filter(function(n) {
          var nCoords = self.getZipCoords(n.zipcode);
          if (!nCoords) return false;  // Exclude if no coords
          return haversineDistanceMiles(refCoords.lat, refCoords.lng, nCoords.lat, nCoords.lng) <= maxDist;
        });

        // Region filter
        if (filterRegion) {
          list = list.filter(function(n) { return n.region === filterRegion; });
        }

        // City filter
        if (filterCity) {
          list = list.filter(function(n) { return n.city === filterCity; });
        }

        // Search filter (by name, city, zipcode, or region)
        if (query) {
          list = list.filter(function(n) {
            var searchable = [
              n.name || '',
              n.city || '',
              n.zipcode || '',
              n.region || ''
            ].join(' ').toLowerCase();
            return searchable.indexOf(query) !== -1;
          });
        }

        // 2. NOW compute metrics (only on filtered subset)
        list = list.map(function(n) {
          var updated = Object.assign({}, n, {
            downPaymentPercent: self.downPaymentPercent,
            interestRate: self.interestRate,
            loanTermYears: self.loanTermYears,
            closingCostRate: self.closingCostRate,
          });
          var metrics = self.computeMetrics(updated);
          var affordability = self.checkAffordability(updated);
          return Object.assign({}, updated, { metrics: metrics, affordability: affordability });
        });

        // 3. Affordability filter (needs metrics)
        if (this.filterAffordable && this.hasFinancials) {
          list = list.filter(function(n) { return n.affordability.affordable; });
        }

        // 4. Sort
        list.sort(function(a, b) {
          var valA, valB;
          if (sortBy === 'totalROI') { valA = a.metrics.totalAnnualReturn; valB = b.metrics.totalAnnualReturn; }
          else if (sortBy === 'capRate') { valA = a.metrics.capRate; valB = b.metrics.capRate; }
          else if (sortBy === 'monthlyCashFlow') { valA = a.metrics.monthlyCashFlow; valB = b.metrics.monthlyCashFlow; }
          else if (sortBy === 'totalValue5') {
            valA = a.metrics.totalValueProjection[4] ? a.metrics.totalValueProjection[4].netGain : -Infinity;
            valB = b.metrics.totalValueProjection[4] ? b.metrics.totalValueProjection[4].netGain : -Infinity;
          }
          else if (sortBy === 'totalValue10') {
            valA = a.metrics.totalValueProjection[9] ? a.metrics.totalValueProjection[9].netGain : -Infinity;
            valB = b.metrics.totalValueProjection[9] ? b.metrics.totalValueProjection[9].netGain : -Infinity;
          }
          else if (sortBy === 'appreciation') { valA = a.metrics.appreciation5yr || 0; valB = b.metrics.appreciation5yr || 0; }
          else if (sortBy === 'appreciation1yr') { valA = a.appreciationRate || 0; valB = b.appreciationRate || 0; }
          else if (sortBy === 'city') { return (a.city || '').localeCompare(b.city || ''); }
          else if (sortBy === 'priceDesc') { valA = a.medianPrice; valB = b.medianPrice; return valB - valA; }
          else if (sortBy === 'price') { valA = a.medianPrice; valB = b.medianPrice; }
          else { valA = a.metrics.totalAnnualReturn; valB = b.metrics.totalAnnualReturn; }
          return direction === 'desc' ? (valB - valA) : (valA - valB);
        });

        return list;
      },

      get affordableCount() {
        if (!this.hasFinancials) return this.neighborhoods.length;
        var self = this;
        return this.neighborhoods.filter(function(n) {
          return self.checkAffordability(n).affordable;
        }).length;
      },

      // ── Top Picks (Priority Neighborhoods) ─────────────────────
      get topPicks() {
        var self = this;

        // Get affordable neighborhoods with valid rent data
        var candidates = this.rankedNeighborhoods.filter(function(n) {
          var isAffordable = !self.hasFinancials || n.affordability.affordable;
          var hasRent = n.expectedRent > 0;
          return isAffordable && hasRent;
        });

        if (candidates.length === 0) return null;

        // Best Cap Rate
        var bestCapRate = candidates.slice().sort(function(a, b) {
          return b.metrics.capRate - a.metrics.capRate;
        })[0];

        // Best Cash Flow
        var bestCashFlow = candidates.slice().sort(function(a, b) {
          return b.metrics.monthlyCashFlow - a.metrics.monthlyCashFlow;
        })[0];

        // Cheapest Entry (lowest cash needed)
        var cheapestEntry = candidates.slice().sort(function(a, b) {
          return a.metrics.cashInvested - b.metrics.cashInvested;
        })[0];

        // Best Total ROI (cash flow + leveraged appreciation)
        var bestTotalROI = candidates.slice().sort(function(a, b) {
          return b.metrics.totalAnnualReturn - a.metrics.totalAnnualReturn;
        })[0];

        return {
          totalROI: bestTotalROI,
          capRate: bestCapRate,
          cashFlow: bestCashFlow,
          cheapest: cheapestEntry,
        };
      },

      // Rent-to-price ratio helper
      rentToPrice: function(n) {
        if (!n || n.medianPrice <= 0) return 0;
        return n.expectedRent / n.medianPrice;
      },

      // Get coordinates for a zipcode
      getZipCoords: function(zipcode) {
        return window.ZIPCODE_COORDS ? window.ZIPCODE_COORDS[zipcode] : null;
      },

      // ── Formatting Helpers ────────────────────────────────────
      fmt: function(val) { return formatCurrency(val); },
      pct: function(val) { return formatPercent(val); },
    };
  });
});
