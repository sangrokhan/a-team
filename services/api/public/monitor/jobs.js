const POLL_MS = 5000;

const elements = {
  refreshNote: document.getElementById('history-refresh-note'),
  autoRefresh: document.getElementById('history-auto-refresh'),
  refreshNow: document.getElementById('history-refresh-now'),
  refreshSelected: document.getElementById('refresh-selected'),
  jobCount: document.getElementById('job-count'),
  historyStatus: document.getElementById('history-status'),
  jobsBody: document.getElementById('history-jobs-body'),
  statusFilter: document.getElementById('history-status-filter'),
  modeFilter: document.getElementById('history-mode-filter'),
  providerFilter: document.getElementById('history-provider-filter'),
  limitFilter: document.getElementById('history-limit'),
  filterForm: document.getElementById('history-filters'),
  clearFilterBtn: document.getElementById('history-clear'),
  detailTitle: document.getElementById('detail-title'),
  detailSummary: document.getElementById('history-summary'),
  detailOutput: document.getElementById('history-output'),
  detailTeam: document.getElementById('history-team'),
  detailEvents: document.getElementById('history-events'),
};

const state = {
  jobs: [],
  selectedJobId: null,
};

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toLocaleString();
}

function formatTime(iso) {
  if (!iso) return 'N/A';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

function statusPill(status) {
  return `<span class="status-pill ${status || ''}">${status || 'unknown'}</span>`;
}

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function isTeamMode(mode) {
  return mode === 'team';
}

function buildQuery() {
  const params = new URLSearchParams();
  const limit = Number(elements.limitFilter.value || 100);
  params.set('limit', Number.isFinite(limit) && limit > 0 ? String(limit) : '100');

  const statuses = elements.statusFilter.value.trim();
  if (statuses) params.append('statuses', statuses);

  const modes = elements.modeFilter.value.trim();
  if (modes) params.append('modes', modes);

  return params;
}

function clearSelection(message = 'Select a job to inspect.') {
  state.selectedJobId = null;
  elements.detailTitle.textContent = 'Job Detail';
  elements.historyStatus.textContent = message;
  elements.detailSummary.textContent = 'Select a job to inspect.';
  elements.detailOutput.textContent = '-';
  elements.detailTeam.textContent = '-';
  elements.detailEvents.innerHTML = '<li class="empty">No events yet.</li>';

  for (const row of elements.jobsBody.querySelectorAll('.job-row')) {
    row.classList.remove('selected');
  }
}

function renderJobList(jobs) {
  state.jobs = jobs;
  elements.jobCount.textContent = `Total: ${formatNumber(jobs.length)}`;

  if (!jobs.length) {
    elements.jobsBody.innerHTML = '<tr><td colspan="6" class="empty">No jobs found.</td></tr>';
    return;
  }

  elements.jobsBody.innerHTML = jobs
    .map((job) => {
      const selected = state.selectedJobId === job.id ? ' selected' : '';
      return `
        <tr class="job-row${selected}" data-job-id="${job.id}">
          <td>${job.id.slice(0, 8)}...</td>
          <td>${statusPill(job.status)}</td>
          <td>${job.mode}</td>
          <td>${job.provider}</td>
          <td>${job.task}</td>
          <td>${formatTime(job.updatedAt)}</td>
        </tr>
      `;
    })
    .join('');

  for (const row of elements.jobsBody.querySelectorAll('.job-row')) {
    row.addEventListener('click', () => {
      const next = row.getAttribute('data-job-id');
      if (!next || next === state.selectedJobId) return;
      selectJob(next);
    });
  }

  if (!state.selectedJobId && jobs.length > 0) {
    selectJob(jobs[0].id);
  } else if (state.selectedJobId && !jobs.find((job) => job.id === state.selectedJobId)) {
    clearSelection('Selected job removed from current view.');
  }
}

function renderEvents(events) {
  if (!events.length) {
    elements.detailEvents.innerHTML = '<li class="empty">No events yet.</li>';
    return;
  }

  elements.detailEvents.innerHTML = events
    .map(
      (event) => `
      <li>
        <span class="when">${formatTime(event.createdAt)}</span>
        <span class="event-type">${event.type}</span>
        <div>${event.message}</div>
      </li>
    `,
    )
    .join('');
}

function formatJobSummary(job) {
  if (!job) return '-';
  const summary = {
    id: job.id,
    mode: job.mode,
    provider: job.provider,
    status: job.status,
    repo: job.repo,
    ref: job.ref,
    task: job.task,
    approvalState: job.approvalState,
    startedAt: job.startedAt ?? null,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt ?? null,
    error: job.error ?? null,
  };

  return JSON.stringify(summary, null, 2);
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;

  for (const row of elements.jobsBody.querySelectorAll('.job-row')) {
    row.classList.toggle('selected', row.getAttribute('data-job-id') === jobId);
  }

  elements.detailTitle.textContent = `Job ${jobId.slice(0, 8)}...`;
  elements.historyStatus.textContent = 'Loading details...';
  elements.detailSummary.textContent = 'Loading...';
  elements.detailOutput.textContent = 'Loading...';
  elements.detailTeam.textContent = 'Loading...';

  try {
    const job = await readJson(`/v1/jobs/${encodeURIComponent(jobId)}`);
    elements.detailSummary.textContent = formatJobSummary(job);
    elements.detailOutput.textContent = job.output ? JSON.stringify(job.output, null, 2) : 'No output yet.';
    elements.historyStatus.textContent = `Status: ${job.status}`;

    if (isTeamMode(job.mode)) {
      try {
        const teamState = await readJson(`/v1/jobs/${encodeURIComponent(jobId)}/team`);
        elements.detailTeam.textContent = JSON.stringify(teamState, null, 2);
      } catch {
        elements.detailTeam.textContent = 'Team state unavailable.';
      }
    } else {
      elements.detailTeam.textContent = 'This job is not team mode.';
    }

    const events = await readJson(`/v1/jobs/${encodeURIComponent(jobId)}/events/list?limit=200`);
    renderEvents(Array.isArray(events) ? events : []);
  } catch (error) {
    elements.historyStatus.textContent = `Failed to load job ${jobId.slice(0, 8)}...`;
    elements.detailSummary.textContent = `Failed to load details: ${error.message}`;
    elements.detailOutput.textContent = '-';
    elements.detailTeam.textContent = '-';
    elements.detailEvents.innerHTML = '<li class="empty">Failed to load events.</li>';
  }
}

async function refreshList() {
  try {
    const provider = elements.providerFilter.value.trim();
    const response = await readJson(`/v1/jobs?${buildQuery().toString()}`);
    let jobs = Array.isArray(response) ? response : [];
    if (provider) {
      jobs = jobs.filter((job) => job.provider === provider);
    }
    renderJobList(jobs);
    elements.refreshNote.textContent = `Updated at ${new Date().toLocaleString()}`;
  } catch (error) {
    elements.refreshNote.textContent = `Could not refresh list: ${error.message}`;
    elements.jobsBody.innerHTML = '<tr><td colspan="6" class="empty">Unable to load jobs.</td></tr>';
  }
}

function clearFilters() {
  elements.statusFilter.value = '';
  elements.modeFilter.value = '';
  elements.providerFilter.value = '';
  elements.limitFilter.value = '100';
  refreshList();
}

elements.refreshNow.addEventListener('click', () => {
  refreshList();
  if (state.selectedJobId) {
    selectJob(state.selectedJobId);
  }
});

elements.refreshSelected.addEventListener('click', () => {
  if (!state.selectedJobId) return;
  selectJob(state.selectedJobId);
});

elements.filterForm.addEventListener('submit', (event) => {
  event.preventDefault();
  refreshList();
});

elements.clearFilterBtn.addEventListener('click', clearFilters);

setInterval(() => {
  if (!elements.autoRefresh.checked) return;
  refreshList();
  if (state.selectedJobId) {
    selectJob(state.selectedJobId);
  }
}, POLL_MS);

refreshList();
