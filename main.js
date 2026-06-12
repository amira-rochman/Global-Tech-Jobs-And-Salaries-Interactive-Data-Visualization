// GLOBAL DATA STATE (keywords: dataset state, filtered jobs, active filter)
let allJobs = [];      
let globalFilteredJobs = []; 
let activeJobs = [];         
let activeCountryFilter = null; 

// CHART INSTANCES (keywords: Chart.js instances, Plotly chart references)
let roleSalaryChart;
let salaryHistogramChart;
let remoteOnsiteChart;
let roleMetaData = []; 
let remoteMetaData = []; 
let mapChartReady = false; 

const MEDIAN_MAX_USD = 1200000;

function computeJapanUsdHeuristicStats(jobs) { return {}; }

// HELPER FUNCTIONS (keywords: CSS variable helper, number formatting helper)
function getCSSVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function formatInt(n) { const num = Number(n); return !Number.isFinite(num) ? '' : Math.round(num).toLocaleString('nl-NL'); }

// THEME UPDATE FOR CHARTS (keywords: theme chart colors, dark mode chart update)
function applyThemeToCharts() {
  const textMuted = getCSSVar('--text-muted') || '#9ca3af';
  const gridColor = getCSSVar('--chart-grid-color') || 'rgba(255,255,255,0.05)';
  Chart.defaults.color = textMuted;
  if (roleSalaryChart && roleSalaryChart.options.scales.x) { roleSalaryChart.options.scales.x.grid.color = gridColor; roleSalaryChart.update(); }
  if (salaryHistogramChart && salaryHistogramChart.options.scales.y) { salaryHistogramChart.options.scales.y.grid.color = gridColor; salaryHistogramChart.update(); }
  if (remoteOnsiteChart && remoteOnsiteChart.options.scales.y) { remoteOnsiteChart.options.scales.y.grid.color = gridColor; remoteOnsiteChart.update(); }
  
  const boxEl = document.getElementById('scatter-chart');
  if (boxEl && boxEl.data) {
    Plotly.relayout(boxEl, {
      'xaxis.tickfont.color': textMuted,
      'yaxis.tickfont.color': textMuted,
      'xaxis.gridcolor': gridColor,
      'yaxis.gridcolor': gridColor
    });
  }
}

// THEME TOGGLE SETUP (keywords: light dark mode, theme toggle, localStorage theme)
function initThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) return;
  const saved = localStorage.getItem('theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  const initial = saved || (prefersLight ? 'light' : 'dark');

  const setTheme = (theme) => {
    document.documentElement.dataset.theme = theme;
    toggle.checked = theme === 'light'; 
    applyThemeToCharts();
    if (typeof Plotly !== 'undefined' && globalFilteredJobs.length > 0) updateCountryChart();
  };

  setTheme(initial);
  toggle.addEventListener('change', (e) => {
    const next = e.target.checked ? 'light' : 'dark';
    localStorage.setItem('theme', next); setTheme(next);
  });
}

// CSV PARSER (keywords: parse CSV, convert CSV to objects, data import)
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length === 0) return [];
  const headers = lines[0].replace('\r', '').split(';').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i]; if (!line) continue;
    const values = line.replace('\r', '').split(';');
    const rowObject = {};
    headers.forEach((header, index) => { rowObject[header] = values[index] !== undefined ? values[index].trim() : ''; });
    rows.push(rowObject);
  }
  return rows;
}

// EXPERIENCE FILTER SETUP (keywords: experience dropdown, filter options, clear filter button)
function initExperienceFilter(data) {
  const select = document.getElementById('experience-filter');
  const levels = new Set(); 
  data.forEach(row => { if (row.experience_level) levels.add(row.experience_level); });
  const customOrder = { 'Entry': 1, 'EN': 1, 'Junior': 1, 'MI': 2, 'Mid': 2, 'SE': 3, 'Senior': 3, 'EX': 4, 'Lead': 4, 'Director': 5 };
  const sortedLevels = Array.from(levels).sort((a, b) => (customOrder[a] || 99) - (customOrder[b] || 99));

  sortedLevels.forEach(level => {
    const option = document.createElement('option'); option.value = level; option.textContent = level; select.appendChild(option);
  });

  select.addEventListener('change', () => { 
    activeCountryFilter = null;
    applyFilters(); 
    updateAllVisuals(); 
  });

  const clearBtn = document.getElementById('clear-filter-btn');
  if(clearBtn) {
    clearBtn.addEventListener('click', () => {
      activeCountryFilter = null;
      applyFilters();
      updateAllVisuals();
    });
  }
}

// APPLY ACTIVE FILTERS (keywords: filter logic, country filter, experience filter)
function applyFilters() {
  const selectedExp = document.getElementById('experience-filter').value;
  const countryMapping = { 'USA': 'United States', 'US': 'United States', 'UK': 'United Kingdom', 'GB': 'United Kingdom', 'SG': 'Singapore' };
  
  globalFilteredJobs = selectedExp === 'all' ? allJobs : allJobs.filter(job => job.experience_level === selectedExp);
  
  if (activeCountryFilter) {
    activeJobs = globalFilteredJobs.filter(job => {
      const c = countryMapping[job.country] || job.country;
      return c === activeCountryFilter;
    });
    
    document.getElementById('clear-filter-btn').classList.remove('hidden');
    document.getElementById('kpi-country').innerText = activeCountryFilter;
    
    const subtitle = document.getElementById('kpi-origin-subtitle');
    subtitle.innerText = "Filtered Location";
    subtitle.className = "trend standard"; 
  } else {
    activeJobs = [...globalFilteredJobs];
    
    document.getElementById('clear-filter-btn').classList.add('hidden');
    document.getElementById('kpi-country').innerText = "Global";
    
    const subtitle = document.getElementById('kpi-origin-subtitle');
    subtitle.innerText = "10 Countries";
    subtitle.className = "trend info"; 
  }

  // FIX: Dynamic check to update the "Total Available Roles" badge
  const rolesSubtitle = document.getElementById('kpi-roles-subtitle');
  if (selectedExp === 'all' && activeCountryFilter === null) {
    rolesSubtitle.innerText = "Full Dataset";
  } else {
    rolesSubtitle.innerText = "Filtered Matches";
  }
}

// SALARY CONVERSION TO USD (keywords: currency conversion, normalize salary, salary in USD)
function getSalaryInUSD(job) {
  const salary = parseFloat(job.salary_local_currency);
  if (isNaN(salary) || salary === 0) return 0;
  const currency = (job.currency || '').trim().toUpperCase(), country = (job.country || '').trim();
  if (currency === 'INR') return salary * 0.012;      
  if (currency === 'EUR') return salary * 1.09;       
  if (currency === 'GBP') return salary * 1.27;       
  if (currency === 'CAD') return salary * 0.74;       
  if (currency === 'AUD') return salary * 0.65;       
  if (currency === 'SGD') return salary * 0.74;       
  if (currency === 'JPY' || (currency === 'USD' && country === 'Japan' && salary > 1000000)) { return salary * 0.0067; }
  return salary; 
}

// MEDIAN CALCULATION (keywords: median function, salary median math)
function getMedian(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// ROLE MEDIAN DATA FOR BAR CHART (keywords: median salary by role, role chart data)
function getMedianSalaryByRole(jobs) {
  const roleSalaries = {}; 
  jobs.forEach(job => {
    const role = job.job_title; const salary = getSalaryInUSD(job);
    if (!role || salary === 0 || salary > MEDIAN_MAX_USD) return;
    if (!roleSalaries[role]) roleSalaries[role] = [];
    roleSalaries[role].push(salary);
  });
  
  const sorted = Object.keys(roleSalaries).map(role => {
    const arr = roleSalaries[role];
    return { role, median: Math.round(getMedian(arr)), min: Math.round(Math.min(...arr)), max: Math.round(Math.max(...arr)), count: arr.length };
  }).sort((a, b) => b.median - a.median);
    
  return { labels: sorted.map(r => r.role), medians: sorted.map(r => r.median), meta: sorted };
}

// HISTOGRAM DATA PREP (keywords: salary histogram, salary bins, salary ranges)
function getSalaryHistogram(jobs, binSize = 50000) {
  const maxCap = 300000; const bins = {};
  jobs.forEach(job => {
    const salary = getSalaryInUSD(job); if (salary === 0) return;
    if (salary >= maxCap) { bins['$300k+'] = (bins['$300k+'] || 0) + 1; return; }
    const start = Math.floor(salary / binSize) * binSize;
    let label = start === 0 ? `<$50k` : `$${start / 1000}k-$${(start + binSize - 1) / 1000}k`;
    bins[label] = (bins[label] || 0) + 1;
  });
  const sorted = Object.keys(bins).sort((a, b) => {
    if(a.includes('+')) return 1; if(b.includes('+')) return -1;
    if(a.includes('<')) return -1; if(b.includes('<')) return 1;
    return parseInt(a.replace('$', '').split('k')[0]) - parseInt(b.replace('$', '').split('k')[0]);
  });
  return { labels: sorted, counts: sorted.map(l => bins[l]) };
}

// REMOTE VS HYBRID VS ON-SITE DATA (keywords: remote salary comparison, work mode chart)
function getRemoteVsOnsite(jobs) {
  const g = { remote: [], hybrid: [], onsite: [] }; 
  jobs.forEach(job => {
    const s = getSalaryInUSD(job); if (s === 0 || s > MEDIAN_MAX_USD) return; 
    const t = (job.remote_type || '').toLowerCase();
    if (t.includes('hybrid')) g.hybrid.push(s);
    else if (t.includes('remote')) g.remote.push(s);
    else if (t.includes('onsite') || t.includes('office')) g.onsite.push(s);
  });
  function getStats(arr) {
    if(arr.length === 0) return { median: null, min: 0, max: 0, count: 0};
    return { median: Math.round(getMedian(arr)), min: Math.round(Math.min(...arr)), max: Math.round(Math.max(...arr)), count: arr.length };
  }
  const rStats = getStats(g.remote), hStats = getStats(g.hybrid), oStats = getStats(g.onsite);
  return { labels: ['Remote', 'Hybrid', 'On-site'], medians: [rStats.median, hStats.median, oStats.median], meta: [rStats, hStats, oStats] };
}

// COUNTRY COUNT AGGREGATION (keywords: jobs per country, map country counts)
function getJobCountByCountry(jobs) {
  const counts = {};
  const countryMapping = { 'USA': 'United States', 'US': 'United States', 'UK': 'United Kingdom', 'GB': 'United Kingdom', 'SG': 'Singapore' };
  jobs.forEach(job => {
    if (!job.country) return;
    const countryName = countryMapping[job.country] || job.country;
    counts[countryName] = (counts[countryName] || 0) + 1;
  });
  return counts;
}

// CHART INITIALIZATION (keywords: create charts, Chart.js setup)
function initCharts() {
  Chart.defaults.color = getCSSVar('--text-muted') || '#9ca3af';
  Chart.defaults.font.family = "'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  Chart.defaults.font.size = 12;
  const colorPurple = '#8b5cf6', colorIndigo = '#6366f1', colorPink = '#ec4899', colorGreen = '#22c55e';

  roleSalaryChart = new Chart(document.getElementById('role-salary-chart').getContext('2d'), {
    type: 'bar', data: { labels: [], datasets: [{ label: 'Median', data: [], backgroundColor: colorPurple, borderRadius: 6, maxBarThickness: 30 }] }, 
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuad' }, scales: { x: { beginAtZero: false, grid: { color: getCSSVar('--chart-grid-color') || 'rgba(255,255,255,0.05)' }, ticks: { padding: 8, callback: v => '$' + (v / 1000) + 'k' } }, y: { grid: { display: false }, ticks: { padding: 8 } } }, plugins: { legend: { display: false }, tooltip: { padding: 12, titleFont: { size: 14 }, bodyFont: { size: 13 }, bodySpacing: 6, callbacks: { label: function(context) { const m = roleMetaData[context.dataIndex]; if(!m) return ''; return [ `Median: $${m.median.toLocaleString('nl-NL')}`, `Range: $${m.min.toLocaleString('nl-NL')} - $${m.max.toLocaleString('nl-NL')}`, `Based on: ${m.count.toLocaleString('nl-NL')} jobs` ]; } } } } }
  });

  salaryHistogramChart = new Chart(document.getElementById('salary-histogram-chart').getContext('2d'), {
    type: 'bar', data: { labels: [], datasets: [{ label: 'Jobs Count', data: [], backgroundColor: colorIndigo, borderRadius: 6, categoryPercentage: 0.9, barPercentage: 0.9 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuad' }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, padding: 8 } }, y: { grid: { color: getCSSVar('--chart-grid-color') || 'rgba(255,255,255,0.05)' }, ticks: { padding: 8 } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' ' + c.parsed.y.toLocaleString('nl-NL') + ' jobs' } } } }
  });

  remoteOnsiteChart = new Chart(document.getElementById('remote-onsite-chart').getContext('2d'), {
    type: 'bar', data: { labels: [], datasets: [{ label: 'Median', data: [], backgroundColor: [colorIndigo, colorGreen, colorPink], borderRadius: 8, maxBarThickness: 60 }] }, 
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 650, easing: 'easeOutQuad' }, scales: { x: { grid: { display: false }, ticks: { padding: 8 } }, y: { beginAtZero: false, grid: { color: getCSSVar('--chart-grid-color') || 'rgba(255,255,255,0.05)' }, ticks: { padding: 8, callback: v => '$' + (v / 1000) + 'k' } } }, plugins: { legend: { display: false }, tooltip: { padding: 12, titleFont: { size: 14 }, bodyFont: { size: 13 }, bodySpacing: 6, callbacks: { label: function(context) { const m = remoteMetaData[context.dataIndex]; if(!m || m.count === 0) return 'No data'; return [ `Median: $${m.median.toLocaleString('nl-NL')}`, `Range: $${m.min.toLocaleString('nl-NL')} - $${m.max.toLocaleString('nl-NL')}`, `Based on: ${m.count.toLocaleString('nl-NL')} jobs` ]; } } } } }
  });
}

// BOXPLOT UPDATE (keywords: salary variance chart, box plot update)
function updateBoxChart(jobs) {
  const displayJobs = jobs.slice(0, 300); 
  toggleEmptyState('empty-scatter', displayJobs.length === 0);
  
  if (displayJobs.length === 0) return;

  const jobTitles = [];
  const salaries = [];
  const hoverTexts = [];

  displayJobs.forEach(job => {
    const salary = getSalaryInUSD(job);
    if(salary > 0 && salary <= MEDIAN_MAX_USD) {
      jobTitles.push(job.job_title || 'Unknown');
      salaries.push(salary);
      hoverTexts.push(`Exp: ${job.experience_level}<br>Remote: ${job.remote_type}`);
    }
  });

  const textMuted = getCSSVar('--text-muted') || '#9ca3af';
  const gridColor = getCSSVar('--chart-grid-color') || 'rgba(255,255,255,0.05)';
  const accentColor = getCSSVar('--accent') || '#8b5cf6';

  const boxData = [{
    type: 'box',
    x: jobTitles,
    y: salaries,
    text: hoverTexts,
    hoverinfo: 'y+text',
    boxpoints: 'all', 
    jitter: 0.3,      
    pointpos: -1.8,   
    marker: { color: accentColor, size: 4, opacity: 0.6 },
    line: { color: accentColor, width: 2 }
  }];

  const layout = {
    autosize: true,
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    margin: { l: 80, r: 20, t: 10, b: 100 },
    dragmode: false, 
    xaxis: {
      tickfont: { color: textMuted },
      gridcolor: gridColor,
      tickangle: -45,
      fixedrange: true,
      automargin: true
    },
    yaxis: {
      tickfont: { color: textMuted },
      gridcolor: gridColor,
      tickprefix: '$',
      fixedrange: true 
    }
  };

  Plotly.react('scatter-chart', boxData, layout, { responsive: true, displayModeBar: false });
}

// EMPTY STATE TOGGLE (keywords: no data overlay, show hide empty state)
function toggleEmptyState(elementId, isEmpty) {
  const el = document.getElementById(elementId);
  if (el) { if (isEmpty) el.classList.add('active'); else el.classList.remove('active'); }
}

let lastTotalJobsCount = 0; 
// KPI NUMBER ANIMATION (keywords: animated counter, total jobs animation)
function animateValue(obj, start, end, duration) {
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3); 
    obj.innerText = Math.floor(ease * (end - start) + start).toLocaleString('nl-NL');
    if (progress < 1) window.requestAnimationFrame(step); else obj.innerText = end.toLocaleString('nl-NL'); 
  };
  window.requestAnimationFrame(step);
}

// MAIN UI REFRESH (keywords: update dashboard, redraw all charts, re-render visuals)
function updateAllVisuals() {
  document.body.classList.add('dash-updating');
  
  const locText = activeCountryFilter ? `in <span class="insight-highlight">${activeCountryFilter}</span>` : 'globally';

  const totalJobsCount = activeJobs.length;
  const totalJobsElement = document.getElementById('total-jobs-count');
  if (totalJobsElement) { animateValue(totalJobsElement, lastTotalJobsCount, totalJobsCount, 700); lastTotalJobsCount = totalJobsCount; }

  // --- ROLE CHART ---
  const roleData = getMedianSalaryByRole(activeJobs); 
  roleMetaData = roleData.meta || [];
  document.getElementById('role-wrapper').style.height = `${Math.max(280, roleData.labels.length * 35)}px`; 
  roleSalaryChart.data.labels = roleData.labels; 
  roleSalaryChart.data.datasets[0].data = roleData.medians; 
  toggleEmptyState('empty-role', roleData.labels.length === 0);
  if (roleData.medians.length > 0) {
    const minVal = Math.min(...roleData.medians), maxVal = Math.max(...roleData.medians);
    if ((maxVal - minVal) === 0) { roleSalaryChart.options.scales.x.min = Math.max(minVal - 5000, 0); roleSalaryChart.options.scales.x.max = minVal + 5000; } 
    else { delete roleSalaryChart.options.scales.x.min; delete roleSalaryChart.options.scales.x.max; }
    document.getElementById('insight-role').innerHTML = `The highest paying position ${locText} is <span class="insight-highlight">${roleMetaData[0].role}</span>.`;
  } else { document.getElementById('insight-role').innerHTML = 'Waiting for data...'; }
  roleSalaryChart.update(); 

  // --- HISTOGRAM ---
  const histData = getSalaryHistogram(activeJobs);
  salaryHistogramChart.data.labels = histData.labels; 
  salaryHistogramChart.data.datasets[0].data = histData.counts;
  toggleEmptyState('empty-hist', histData.labels.length === 0);
  if (histData.counts.length > 0) {
    const maxCount = Math.max(...histData.counts), maxIndex = histData.counts.indexOf(maxCount);
    const percentHist = totalJobsCount > 0 ? ((maxCount / totalJobsCount) * 100).toFixed(1) : 0;
    document.getElementById('insight-histogram').innerHTML = `The majority of roles ${locText} fall within <span class="insight-highlight">${histData.labels[maxIndex]}</span>.`;
  } else { document.getElementById('insight-histogram').innerHTML = 'Waiting for data...'; }
  salaryHistogramChart.update();
  
  // --- REMOTE CHART ---
  const roData = getRemoteVsOnsite(activeJobs);
  remoteOnsiteChart.data.labels = roData.labels; 
  remoteMetaData = roData.meta || [];
  remoteOnsiteChart.data.datasets[0].data = roData.medians; 
  const valid = roData.medians.filter(v => v !== null && v !== undefined && Number.isFinite(v));
  toggleEmptyState('empty-remote', valid.length === 0);
  if (valid.length > 0) {
    const minVal = Math.min(...valid), maxVal = Math.max(...valid);
    if ((maxVal - minVal) === 0) { remoteOnsiteChart.options.scales.y.min = Math.max(minVal - 5000, 0); remoteOnsiteChart.options.scales.y.max = minVal + 5000; } 
    else { delete remoteOnsiteChart.options.scales.y.min; delete remoteOnsiteChart.options.scales.y.max; }
    const categories = roData.labels.map((label, i) => ({ label, median: roData.medians[i] })).filter(c => c.median !== null);
    categories.sort((a, b) => b.median - a.median);
    document.getElementById('insight-remote').innerHTML = `<span class="insight-highlight">${categories[0].label}</span> roles have the highest median salary ${locText}.`;
  } else { document.getElementById('insight-remote').innerHTML = 'Waiting for data...'; }
  remoteOnsiteChart.update();

  // --- BOX CHART ---
  updateBoxChart(activeJobs);

  // --- MAP & LIST ---
  updateCountryChart(); 

  const globalCountryCounts = getJobCountByCountry(globalFilteredJobs);
  const sortedCountries = Object.keys(globalCountryCounts).map(c => ({ country: c, count: globalCountryCounts[c] })).sort((a, b) => b.count - a.count).slice(0, 5);
  const listElement = document.getElementById('top-countries');
  
  toggleEmptyState('empty-countries', sortedCountries.length === 0);

  if(listElement) {
    listElement.innerHTML = '';
    sortedCountries.forEach((item, index) => {
      const percentage = globalFilteredJobs.length > 0 ? ((item.count / globalFilteredJobs.length) * 100).toFixed(1) : 0;
      const li = document.createElement('li');
      
      li.setAttribute('data-country', item.country);
      li.style.animationDelay = `${index * 0.08}s`; 
      
      if (item.country === activeCountryFilter) { li.classList.add('active-filter'); }

      li.innerHTML = `<div class="rank-info"><span class="rank-num" style="font-weight: 800; color: #475569; margin-right: 12px;">#${index + 1}</span><span class="country-name">${item.country}</span></div><span class="job-badge">${item.count.toLocaleString('nl-NL')} (${percentage}%)</span>`;
      
      li.addEventListener('mouseenter', () => {
        // LIST TO MAP HOVER LINK (keywords: hover country list highlights map)
        if (!mapChartReady || !window.Plotly) return;
        const mapEl = document.getElementById('country-map-chart');
        if (!mapEl.data || !mapEl.data[0] || !mapEl.data[0].locations) return;
        const pointIndex = mapEl.data[0].locations.indexOf(item.country);
        if(pointIndex > -1) {
          Plotly.Fx.hover(mapEl, [{curveNumber: 0, pointNumber: pointIndex}]);
          Plotly.restyle(mapEl, { locations: [[item.country]], z: [[1]] }, [1]);
        }
      });

      li.addEventListener('mouseleave', () => {
        // RESET MAP HIGHLIGHT ON HOVER OUT (keywords: remove map highlight)
        if (!mapChartReady || !window.Plotly) return;
        const mapEl = document.getElementById('country-map-chart');
        Plotly.Fx.unhover(mapEl);
        if (item.country === activeCountryFilter) {
          Plotly.restyle(mapEl, { locations: [[item.country]], z: [[1]], colorscale: [[[0, '#8b5cf6'], [1, '#8b5cf6']]] }, [1]);
        } else if (activeCountryFilter) {
           Plotly.restyle(mapEl, { locations: [[activeCountryFilter]], z: [[1]], colorscale: [[[0, '#8b5cf6'], [1, '#8b5cf6']]] }, [1]);
        } else {
           Plotly.restyle(mapEl, { locations: [[]], z: [[]] }, [1]);
        }
      });

      li.addEventListener('click', () => {
        // COUNTRY FILTER FROM LIST CLICK (keywords: click country filter, top countries click)
        if (activeCountryFilter === item.country) { activeCountryFilter = null; } 
        else { activeCountryFilter = item.country; }
        applyFilters(); updateAllVisuals();
      });

      listElement.appendChild(li);
    });
    
    if (sortedCountries.length > 0) {
        document.getElementById('insight-countries').innerHTML = `<span class="insight-highlight">${sortedCountries[0].country}</span> has the most listings globally.`;
        document.getElementById('insight-map').innerHTML = `Geographic mapping reveals the density of jobs ${locText}.`;
    }
  }

  setTimeout(() => { document.body.classList.remove('dash-updating'); }, 450);
}

// WORLD MAP UPDATE (keywords: map chart update, choropleth map, country map filter)
function updateCountryChart() {
  const globalCountryCounts = getJobCountByCountry(globalFilteredJobs);
  const accent = getCSSVar('--accent') || '#8b5cf6', textMuted = getCSSVar('--text-muted') || '#9ca3af';
  const plotZ0 = getCSSVar('--plot-z0') || '#1f2937', plotLandcolor = getCSSVar('--plot-landcolor') || '#374151';
  
  toggleEmptyState('empty-map', Object.keys(globalCountryCounts).length === 0);

  const ghostLocations = activeCountryFilter ? [activeCountryFilter] : [];
  const ghostZ = activeCountryFilter ? [1] : [];
  const ghostColor = '#8b5cf6'; 

  const mapData = [
    {
      type: 'choropleth', locationmode: 'country names', 
      locations: Object.keys(globalCountryCounts), z: Object.values(globalCountryCounts),
      text: Object.keys(globalCountryCounts).map((loc, i) => `${loc}: ${Object.values(globalCountryCounts)[i].toLocaleString('nl-NL')} jobs`), 
      hoverinfo: 'text', colorscale: [[0, plotZ0], [1, accent]], showscale: true,
      colorbar: { title: { text: 'Job Volume', font: { color: textMuted } }, tickfont: { color: textMuted }, thickness: 12, len: 0.8, bgcolor: 'rgba(0,0,0,0)' },
      marker: { line: { color: getCSSVar('--plot-marker-line') || 'rgba(255, 255, 255, 0.1)', width: 1 } }
    },
    {
      type: 'choropleth', locationmode: 'country names',
      locations: ghostLocations, z: ghostZ, 
      colorscale: [[0, ghostColor], [1, ghostColor]], showscale: false, hoverinfo: 'skip',
      marker: { line: { color: '#ffffff', width: 2 } } 
    }
  ];

  const layout = {
    autosize: true, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent', margin: { l: 0, r: 0, t: 10, b: 0 }, dragmode: 'pan',
    transition: { duration: 500, easing: 'cubic-in-out' }, 
    geo: { resolution: 50, showframe: false, showcoastlines: true, coastlinecolor: 'rgba(255, 255, 255, 0.05)', showland: true, landcolor: plotLandcolor, bgcolor: 'transparent', projection: { type: 'natural earth' } }
  };

  const mapChartEl = document.getElementById('country-map-chart');

  // MAP ZOOM IN FEATURE (keywords: map zoom in, mouse wheel zoom, scroll zoom)
  Plotly.react('country-map-chart', mapData, layout, { responsive: true, scrollZoom: true, displayModeBar: false })
    .then(() => { 
      mapChartReady = true; 
      
      if (!mapChartEl._clickListenersAttached) {
        // MAP CLICK FILTER (keywords: click country on map, map click filter)
        mapChartEl.on('plotly_click', function(data) {
          const clickedCountry = data.points[0].location;
          if (activeCountryFilter === clickedCountry) { activeCountryFilter = null; } 
          else { activeCountryFilter = clickedCountry; }
          applyFilters(); updateAllVisuals();
        });
        mapChartEl._clickListenersAttached = true;
      }

      if (!mapChartEl._hoverListenersAttached) {
        // MAP HOVER LINKS TO COUNTRY LIST (keywords: map hover highlight list)
        mapChartEl.on('plotly_hover', function(data) {
          const hoverCountry = data.points[0].location;
          document.querySelectorAll('#top-countries li').forEach(li => {
            if (li.getAttribute('data-country') === hoverCountry) li.classList.add('highlight-match');
          });
        });
        mapChartEl.on('plotly_unhover', function(data) {
          document.querySelectorAll('#top-countries li').forEach(li => li.classList.remove('highlight-match'));
        });
        mapChartEl._hoverListenersAttached = true;
      }
    })
    .catch(() => { mapChartReady = true; }); 
}

// DATA LOADING FLOW (keywords: fetch CSV, load dashboard data, initialize app)
async function loadData() {
  const loader = document.getElementById('loading-overlay');
  if (loader) loader.classList.remove('hidden');

  try {
    const response = await fetch('data.csv');
    if (!response.ok) throw new Error(`HTTP ${response.status} while fetching data.csv`);
    const csvText = await response.text();
    allJobs = parseCSV(csvText); 
    
    applyFilters();      
    initExperienceFilter(allJobs);
    initCharts();
    updateAllVisuals();
  } catch (error) { 
    console.error('Error loading data:', error); 
  } finally {
    if (loader) setTimeout(() => loader.classList.add('hidden'), 300); 
  }
}

// RESPONSIVE RESIZE HANDLER (keywords: resize charts, responsive dashboard)
window.addEventListener('resize', () => {
  try { if (roleSalaryChart) roleSalaryChart.resize(); if (salaryHistogramChart) salaryHistogramChart.resize(); if (remoteOnsiteChart) remoteOnsiteChart.resize(); } catch (e) {}
  try { const el = document.getElementById('country-map-chart'); if (el && window.Plotly && mapChartReady) Plotly.Plots.resize(el); } catch (e) {}
  try { const sc = document.getElementById('scatter-chart'); if (sc && window.Plotly) Plotly.Plots.resize(sc); } catch (e) {}
});

// APP STARTUP (keywords: initialize app, run dashboard)
initThemeToggle();
loadData();
