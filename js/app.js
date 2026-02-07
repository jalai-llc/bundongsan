document.addEventListener('alpine:init', function() {
  var F = window.Formulas;
  var D = window.CA_DEFAULTS;

  Alpine.data('nestready', function() {
    return {
      // ── Financial Inputs (persisted) ──────────────────────────
      grossAnnualIncome: Alpine.$persist(0).as('fin_grossAnnualIncome'),
      monthlyExpenses: Alpine.$persist(0).as('fin_monthlyExpenses'),
      currentRent: Alpine.$persist(0).as('fin_currentRent'),
      savingsAvailable: Alpine.$persist(0).as('fin_savings'),
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
        var maxHousingBack = grossMonthly * comfort.backEndDTI - this.monthlyExpenses;

        // Budget constraint: income - debts - other expenses - buffer
        var buffer = grossMonthly * comfort.bufferRate;
        var maxHousingBudget = grossMonthly - this.monthlyExpenses - buffer;

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
        var backEnd = grossMonthly * comfort.backEndDTI - this.monthlyExpenses;
        var budgetBased = grossMonthly - this.monthlyExpenses - (grossMonthly * comfort.bufferRate);

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
        return netMonthly - this.monthlyExpenses - housing;
      },

      // Cash needed for down payment + closing at max price
      get cashNeededAtMaxPrice() {
        var price = this.maxAffordablePrice;
        var dpPct = this.downPaymentPercent / 100;
        var ccPct = this.closingCostRate / 100;
        return price * (dpPct + ccPct);
      },

      // Breakdown of upfront cash at max price
      get downPaymentAtMaxPrice() {
        return this.maxAffordablePrice * (this.downPaymentPercent / 100);
      },

      get closingCostsAtMaxPrice() {
        return this.maxAffordablePrice * (this.closingCostRate / 100);
      },

      get loanAtMaxPrice() {
        return this.maxAffordablePrice * (1 - this.downPaymentPercent / 100);
      },

      // Max affordable price at each comfort level (for comparison display)
      get maxPriceByComfort() {
        if (!this.hasFinancials) return null;
        var self = this;
        var levels = window.COMFORT_LEVELS;
        var result = {};
        for (var key in levels) {
          var maxByIncome = self._calcMaxPriceByIncomeForComfort(levels[key]);
          result[key] = Math.min(maxByIncome, self.maxPriceByCash);
        }
        return result;
      },

      // ── Down Payment Optimizer ────────────────────────────────
      // Helper: calculate max price by income for a given comfort config
      _calcMaxPriceByIncomeForComfort: function(comfort) {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;

        var dpPct = this.downPaymentPercent / 100;
        var rate = this.interestRate / 100;
        var taxRate = this.propertyTaxRate / 100;
        var insRate = D.homeownersInsuranceRate;

        var maxHousingFront = grossMonthly * comfort.frontEndDTI;
        var maxHousingBack = grossMonthly * comfort.backEndDTI - this.monthlyExpenses;
        var buffer = grossMonthly * comfort.bufferRate;
        var maxHousingBudget = grossMonthly - this.monthlyExpenses - buffer;
        var maxMonthlyHousing = Math.min(maxHousingFront, maxHousingBack, maxHousingBudget);
        if (maxMonthlyHousing <= 0) return 0;

        var lo = 0, hi = 10000000;
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

      // Helper: calculate max price by income at a specific DP% (uses current comfort)
      _calcMaxPriceByIncomeAtDP: function(dpPercent) {
        var grossMonthly = this.grossMonthlyIncome;
        if (grossMonthly <= 0) return 0;

        var dpPct = dpPercent / 100;
        var rate = this.interestRate / 100;
        var taxRate = this.propertyTaxRate / 100;
        var insRate = D.homeownersInsuranceRate;
        var comfort = this.comfortConfig;

        var maxHousingFront = grossMonthly * comfort.frontEndDTI;
        var maxHousingBack = grossMonthly * comfort.backEndDTI - this.monthlyExpenses;
        var buffer = grossMonthly * comfort.bufferRate;
        var maxHousingBudget = grossMonthly - this.monthlyExpenses - buffer;
        var maxMonthlyHousing = Math.min(maxHousingFront, maxHousingBack, maxHousingBudget);
        if (maxMonthlyHousing <= 0) return 0;

        var lo = 0, hi = 10000000;
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

      // Curve data for the down payment optimizer chart
      get dpCurveData() {
        if (!this.hasFinancials) return null;

        var points = [];
        var currentDP = this.downPaymentPercent;
        var ccPct = this.closingCostRate / 100;

        // Generate points from 3% to 100%
        var MAX_PRICE = 10000000; // $10M cap
        for (var dp = 3; dp <= 100; dp++) {
          var dpPct = dp / 100;
          var maxByCash = Math.min(MAX_PRICE, Math.floor(this.savingsAvailable / (dpPct + ccPct)));
          var maxByIncome = Math.min(MAX_PRICE, this._calcMaxPriceByIncomeAtDP(dp));
          var maxAffordable = Math.min(maxByCash, maxByIncome);

          points.push({
            dp: dp,
            maxByCash: maxByCash,
            maxByIncome: maxByIncome,
            maxAffordable: maxAffordable,
            limitedBy: maxByCash <= maxByIncome ? 'cash' : 'income',
          });
        }

        // Find optimal (max of maxAffordable)
        var optimal = points.reduce(function(best, p) {
          return p.maxAffordable > best.maxAffordable ? p : best;
        }, points[0]);

        // Find current position
        var current = points.find(function(p) { return p.dp === currentDP; }) || points[0];

        // Calculate potential gain
        var potentialGain = optimal.maxAffordable - current.maxAffordable;

        return {
          points: points,
          optimal: optimal,
          current: current,
          potentialGain: potentialGain,
          isAtOptimal: Math.abs(currentDP - optimal.dp) <= 1,
        };
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

      // ── Map State ───────────────────────────────────────────────
      showMapView: Alpine.$persist(false).as('hood_showMapView'),
      mapColorMetric: Alpine.$persist('auto').as('hood_mapColorMetric'),
      mapInstance: null,
      geoJsonLayer: null,
      zipBoundaries: null,
      mapLoading: false,

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
          // Recenter map if showing
          if (self.showMapView && self.mapInstance) {
            self.recenterMap();
            self.updateMapStyles();
          }
        });

        // Watch for distance changes to recenter map
        this.$watch('filterDistanceMiles', function() {
          if (self.showMapView && self.mapInstance) {
            self.recenterMap();
            self.updateMapStyles();
          }
        });

        // Watch for mode changes to update map tooltips
        this.$watch('mode', function() {
          if (self.showMapView && self.mapInstance) {
            self.updateMapStyles();
          }
        });

        // Watch for financial changes to update affordability colors
        this.$watch('grossAnnualIncome', function() {
          if (self.showMapView && self.mapInstance) {
            self.updateMapStyles();
          }
        });
        this.$watch('savingsAvailable', function() {
          if (self.showMapView && self.mapInstance) {
            self.updateMapStyles();
          }
        });
        this.$watch('downPaymentPercent', function() {
          if (self.showMapView && self.mapInstance) {
            self.updateMapStyles();
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
        this.monthlyExpenses = 0;
        this.currentRent = 0;
        this.savingsAvailable = 0;
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
        var backEndDTI = F.backEndDTI(totalHousing, this.monthlyExpenses, grossMonthly);
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

      // ── Map Methods ──────────────────────────────────────────
      initMap: function() {
        if (this.mapInstance) {
          // Map already initialized, just update styles
          this.updateMapStyles();
          return;
        }
        if (!window.L) {
          console.error('Leaflet not loaded');
          return;
        }

        var mapEl = document.getElementById('neighborhood-map');
        if (!mapEl) return;

        // Get center from user's zipcode or default to LA
        var center = this.getZipCoords(this.filterFromZipcode);
        if (!center) center = { lat: 34.05, lng: -118.25 };

        // Calculate zoom based on distance filter
        var zoom = this.filterDistanceMiles <= 25 ? 11 : (this.filterDistanceMiles <= 50 ? 10 : 9);

        this.mapInstance = L.map('neighborhood-map').setView([center.lat, center.lng], zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
        }).addTo(this.mapInstance);

        // Load boundaries if not loaded
        if (!this.zipBoundaries) {
          this.loadBoundaries();
        } else {
          this.renderBoundaries();
        }
      },

      loadBoundaries: function() {
        var self = this;
        this.mapLoading = true;

        // Fetch CA ZIP code GeoJSON from jsDelivr CDN
        var url = 'https://cdn.jsdelivr.net/gh/OpenDataDE/State-zip-code-GeoJSON@master/ca_california_zip_codes_geo.min.json';

        fetch(url)
          .then(function(response) {
            if (!response.ok) throw new Error('Failed to load boundaries');
            return response.json();
          })
          .then(function(geojson) {
            // Filter to only our neighborhoods
            var ourZips = {};
            if (window.CA_NEIGHBORHOODS) {
              window.CA_NEIGHBORHOODS.forEach(function(n) {
                if (n.zipcode) ourZips[n.zipcode] = true;
              });
            }
            // Also include any custom neighborhoods
            self.neighborhoods.forEach(function(n) {
              if (n.zipcode) ourZips[n.zipcode] = true;
            });

            // Filter features to only our ZIPs
            var filtered = {
              type: 'FeatureCollection',
              features: geojson.features.filter(function(f) {
                var zip = f.properties.ZCTA5CE10 || f.properties.zip_code || f.properties.GEOID10;
                return ourZips[zip];
              })
            };

            self.zipBoundaries = filtered;
            self.renderBoundaries();
            self.mapLoading = false;
          })
          .catch(function(err) {
            console.error('Error loading boundaries:', err);
            self.mapLoading = false;
            // Fallback: show circles instead
            self.renderCircleFallback();
          });
      },

      renderBoundaries: function() {
        var self = this;
        if (!this.mapInstance || !this.zipBoundaries) return;

        // Remove existing layer
        if (this.geoJsonLayer) {
          this.mapInstance.removeLayer(this.geoJsonLayer);
        }

        // Create lookup of ranked neighborhoods by zipcode
        var zipLookup = {};
        this.rankedNeighborhoods.forEach(function(n) {
          if (n.zipcode) zipLookup[n.zipcode] = n;
        });

        this.geoJsonLayer = L.geoJSON(this.zipBoundaries, {
          style: function(feature) {
            var zip = feature.properties.ZCTA5CE10 || feature.properties.zip_code || feature.properties.GEOID10;
            var n = zipLookup[zip];
            var color = self.getZipColor(n);
            var isInRange = !!n;

            return {
              fillColor: color,
              fillOpacity: isInRange ? 0.6 : 0.1,
              color: isInRange ? '#ffffff' : '#94a3b8',
              weight: isInRange ? 1.5 : 0.5,
              opacity: 1
            };
          },
          onEachFeature: function(feature, layer) {
            var zip = feature.properties.ZCTA5CE10 || feature.properties.zip_code || feature.properties.GEOID10;
            var n = zipLookup[zip];

            if (n) {
              // Bind tooltip
              layer.bindTooltip(self.buildTooltipHtml(n), {
                className: 'map-tooltip',
                direction: 'top',
                sticky: true
              });

              // Hover effects
              layer.on('mouseover', function() {
                layer.setStyle({
                  weight: 3,
                  color: '#3b82f6',
                  fillOpacity: 0.8
                });
                layer.bringToFront();
              });

              layer.on('mouseout', function() {
                self.geoJsonLayer.resetStyle(layer);
              });

              // Click to zoom
              layer.on('click', function() {
                self.mapInstance.fitBounds(layer.getBounds(), { padding: [50, 50] });
              });
            }
          }
        }).addTo(this.mapInstance);
      },

      renderCircleFallback: function() {
        // Fallback when GeoJSON fails to load - use circle markers
        var self = this;
        if (!this.mapInstance) return;

        this.rankedNeighborhoods.forEach(function(n) {
          var coords = self.getZipCoords(n.zipcode);
          if (!coords) return;

          var color = self.getZipColor(n);
          var marker = L.circleMarker([coords.lat, coords.lng], {
            radius: 10,
            fillColor: color,
            fillOpacity: 0.7,
            color: '#ffffff',
            weight: 2
          });

          marker.bindTooltip(self.buildTooltipHtml(n), {
            className: 'map-tooltip',
            direction: 'top'
          });

          marker.on('mouseover', function() { this.setRadius(14); });
          marker.on('mouseout', function() { this.setRadius(10); });

          marker.addTo(self.mapInstance);
        });
      },

      updateMapStyles: function() {
        var self = this;
        if (!this.geoJsonLayer || !this.mapInstance) return;

        // Rebuild the lookup with current data
        var zipLookup = {};
        this.rankedNeighborhoods.forEach(function(n) {
          if (n.zipcode) zipLookup[n.zipcode] = n;
        });

        // Update each layer's style
        this.geoJsonLayer.eachLayer(function(layer) {
          var feature = layer.feature;
          var zip = feature.properties.ZCTA5CE10 || feature.properties.zip_code || feature.properties.GEOID10;
          var n = zipLookup[zip];
          var color = self.getZipColor(n);
          var isInRange = !!n;

          layer.setStyle({
            fillColor: color,
            fillOpacity: isInRange ? 0.6 : 0.1,
            color: isInRange ? '#ffffff' : '#94a3b8',
            weight: isInRange ? 1.5 : 0.5
          });

          // Update tooltip content
          if (n) {
            layer.setTooltipContent(self.buildTooltipHtml(n));
          }
        });
      },

      getZipColor: function(n) {
        if (!n) return '#94a3b8'; // gray for out-of-range

        var metric = this.mapColorMetric;
        if (metric === 'auto') {
          metric = this.mode === 'investment' ? 'totalROI' : 'affordability';
        }

        // Affordability - binary color
        if (metric === 'affordability') {
          if (!this.hasFinancials) return '#94a3b8'; // gray
          return n.affordability.affordable ? '#22c55e' : '#ef4444'; // green/red
        }

        // Numeric metrics - HSL scale (red -> yellow -> green)
        var value, min, max;
        if (metric === 'totalROI') {
          value = n.metrics.totalAnnualReturn;
          min = -0.05; max = 0.15;
        } else if (metric === 'capRate') {
          value = n.metrics.capRate;
          min = 0; max = 0.08;
        } else if (metric === 'cashFlow') {
          value = n.metrics.monthlyCashFlow;
          min = -500; max = 500;
        } else if (metric === 'netGain5') {
          var proj = n.metrics.totalValueProjection[4];
          value = proj ? proj.netGain : 0;
          min = -50000; max = 200000;
        } else {
          // Default to total ROI
          value = n.metrics.totalAnnualReturn;
          min = -0.05; max = 0.15;
        }

        // Normalize to 0-1 and convert to HSL
        var pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
        var hue = pct * 120; // red (0) -> green (120)
        return 'hsl(' + hue + ', 70%, 45%)';
      },

      buildTooltipHtml: function(n) {
        var html = '<div class="map-tooltip-header">' + n.zipcode + ' - ' + n.city + '</div>';
        html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Price</span><span class="map-tooltip-value">' + this.fmt(n.medianPrice) + '</span></div>';
        html += '<div class="map-tooltip-divider"></div>';

        if (this.mode === 'investment') {
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Cap Rate</span><span class="map-tooltip-value">' + this.pct(n.metrics.capRate) + '</span></div>';
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Cash Flow</span><span class="map-tooltip-value ' + (n.metrics.monthlyCashFlow >= 0 ? 'map-tooltip-good' : 'map-tooltip-bad') + '">' + this.fmt(n.metrics.monthlyCashFlow) + '/mo</span></div>';
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Total ROI</span><span class="map-tooltip-value ' + (n.metrics.totalAnnualReturn >= 0 ? 'map-tooltip-good' : 'map-tooltip-bad') + '">' + this.pct(n.metrics.totalAnnualReturn) + '/yr</span></div>';
        } else {
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Monthly Cost</span><span class="map-tooltip-value">' + this.fmt(n.metrics.monthlyCostOfOwnership) + '</span></div>';
          if (this.currentRent > 0) {
            var diff = n.metrics.rentVsBuyDiff;
            html += '<div class="map-tooltip-row"><span class="map-tooltip-label">vs. Your Rent</span><span class="map-tooltip-value ' + (diff <= 0 ? 'map-tooltip-good' : 'map-tooltip-bad') + '">' + (diff >= 0 ? '+' : '') + this.fmt(diff) + '/mo</span></div>';
          }
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">Cash Needed</span><span class="map-tooltip-value">' + this.fmt(n.metrics.cashInvested) + '</span></div>';
        }

        // Projections
        html += '<div class="map-tooltip-divider"></div>';
        var p5 = n.metrics.totalValueProjection[4];
        var p10 = n.metrics.totalValueProjection[9];
        if (p5) {
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">5yr Gain</span><span class="map-tooltip-value ' + (p5.netGain >= 0 ? 'map-tooltip-good' : 'map-tooltip-bad') + '">' + (p5.netGain >= 0 ? '+' : '') + this.fmt(p5.netGain) + '</span></div>';
        }
        if (p10) {
          html += '<div class="map-tooltip-row"><span class="map-tooltip-label">10yr Gain</span><span class="map-tooltip-value ' + (p10.netGain >= 0 ? 'map-tooltip-good' : 'map-tooltip-bad') + '">' + (p10.netGain >= 0 ? '+' : '') + this.fmt(p10.netGain) + '</span></div>';
        }

        // Affordability
        if (this.hasFinancials) {
          html += '<div class="map-tooltip-divider"></div>';
          if (n.affordability.affordable) {
            html += '<div class="map-tooltip-good" style="text-align:center;font-weight:600;">Affordable</div>';
          } else {
            html += '<div class="map-tooltip-bad" style="text-align:center;">Need ' + this.fmt(n.affordability.cashShortfall) + ' more</div>';
          }
        }

        return html;
      },

      recenterMap: function() {
        if (!this.mapInstance) return;
        var coords = this.getZipCoords(this.filterFromZipcode);
        if (coords) {
          var zoom = this.filterDistanceMiles <= 25 ? 11 : (this.filterDistanceMiles <= 50 ? 10 : 9);
          this.mapInstance.setView([coords.lat, coords.lng], zoom);
        }
      },

      // ── Formatting Helpers ────────────────────────────────────
      fmt: function(val) { return formatCurrency(val); },
      pct: function(val) { return formatPercent(val); },
    };
  });
});
