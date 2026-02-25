const POLL_MS = 5000;

const elements = {
  jobsBody: document.getElementById('history-jobs-body'),
  refreshNow: document.getElementById('history-refresh-now'),
  refreshSelected: document.getElementById('refresh-selected'),
  matrixContainer: document.getElementById('matrix-container'),
  chatContainer: document.getElementById('chat-container'),
  selectedJobInfo: document.getElementById('selected-job-info'),
  chatTitle: document.getElementById('chat-title'),
};

const state = {
  jobs: [],
  selectedJobId: null,
  selectedTaskId: null,
  teamState: null,
  events: [],
};

const TEAM_ROLES = ['planner', 'researcher', 'designer', 'developer', 'executor', 'verifier'];

async function readJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 1. Job 목록 렌더링 (사이드바)
function renderJobList(jobs) {
  state.jobs = jobs;
  if (!jobs.length) {
    elements.jobsBody.innerHTML = '<tr><td class="empty">No jobs found.</td></tr>';
    return;
  }

  elements.jobsBody.innerHTML = jobs
    .map((job) => {
      const isSelected = state.selectedJobId === job.id;
      return `
        <tr class="job-row ${isSelected ? 'selected' : ''}" data-job-id="${job.id}">
          <td style="padding: 1rem;">
            <div style="font-weight: bold; font-size: 0.9rem;">${job.task.slice(0, 40)}${job.task.length > 40 ? '...' : ''}</div>
            <div style="display: flex; justify-content: space-between; margin-top: 0.4rem;">
              <span class="status-pill ${job.status}">${job.status}</span>
              <span style="font-size: 0.75rem; color: var(--muted);">${new Date(job.updatedAt).toLocaleDateString()}</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  elements.jobsBody.querySelectorAll('.job-row').forEach((row) => {
    row.addEventListener('click', () => selectJob(row.getAttribute('data-job-id')));
  });
}

// 2. 타임라인 매트릭스 렌더링 (오른쪽 상단)
function renderMatrix(teamState) {
  state.teamState = teamState;
  const tasks = teamState.tasks || [];
  
  let html = `<table class="matrix-table"><thead><tr><th class="matrix-header">Agent / Phase</th>`;
  
  // 가로축: Roles (Phases)
  TEAM_ROLES.forEach(role => {
    html += `<th class="matrix-header">${role.toUpperCase()}</th>`;
  });
  html += `</tr></thead><tbody>`;

  // 세로축: 실제 수행된 태스크들 (단순화를 위해 일단 Role별로 매핑)
  TEAM_ROLES.forEach(role => {
    html += `<tr><td class="matrix-role">${role}</td>`;
    TEAM_ROLES.forEach(phase => {
      const task = tasks.find(t => t.role === role); // 실제로는 phase와 role이 일치하는 태스크를 찾아야 함
      if (role === phase && task) {
        const isSelected = state.selectedTaskId === task.id;
        html += `
          <td>
            <div class="matrix-cell ${task.status} ${isSelected ? 'active' : ''}" 
                 data-task-id="${task.id}" 
                 title="${task.name}">
              ${task.status === 'succeeded' ? '✅' : task.status === 'running' ? '⏳' : '•'}
            </div>
          </td>`;
      } else {
        html += `<td><div class="matrix-cell" style="opacity: 0.2; cursor: default;"></div></td>`;
      }
    });
    html += `</tr>`;
  });

  html += `</tbody></table>`;
  elements.matrixContainer.innerHTML = html;

  elements.matrixContainer.querySelectorAll('.matrix-cell[data-task-id]').forEach(cell => {
    cell.addEventListener('click', () => selectTask(cell.getAttribute('data-task-id')));
  });
}

// 3. 채팅 리스트 렌더링 (오른쪽 하단)
function renderChat(taskId) {
  state.selectedTaskId = taskId;
  const task = state.teamState.tasks.find(t => t.id === taskId);
  elements.chatTitle.textContent = task ? `Agent Logs: ${task.role} (${task.id})` : 'Agent Logs';

  // 해당 태스크와 관련된 이벤트 필터링
  const relevantEvents = state.events.filter(e => 
    e.payload?.taskId === taskId || 
    (e.type.startsWith('team.mailbox') && e.message.includes(taskId))
  );

  if (!relevantEvents.length) {
    elements.chatContainer.innerHTML = '<p class="empty">No detailed logs found for this agent node.</p>';
    return;
  }

  elements.chatContainer.innerHTML = relevantEvents
    .map(event => {
      let typeClass = 'agent';
      if (event.type.includes('system') || event.type.includes('phase')) typeClass = 'system';
      
      return `
        <div class="chat-msg ${typeClass}">
          <span class="author">${event.type.split('.').pop().toUpperCase()} <small>${formatTime(event.createdAt)}</small></span>
          <div class="content">${event.message}</div>
          ${event.payload?.reason ? `<div style="font-size: 0.8rem; color: var(--danger); margin-top: 0.3rem;">Reason: ${event.payload.reason}</div>` : ''}
        </div>
      `;
    })
    .join('');
  
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  state.selectedTaskId = null;
  
  const job = state.jobs.find(j => j.id === jobId);
  elements.selectedJobInfo.textContent = job ? `Job: ${job.id.slice(0,8)}... | ${job.task.slice(0,50)}` : '';

  // UI 갱신
  renderJobList(state.jobs);
  
  try {
    const [teamState, events] = await Promise.all([
      readJson(`/v1/jobs/${encodeURIComponent(jobId)}/team`),
      readJson(`/v1/jobs/${encodeURIComponent(jobId)}/events/list?limit=500`)
    ]);
    
    state.events = events;
    renderMatrix(teamState);
    elements.chatContainer.innerHTML = '<p class="empty">Select an agent node from the matrix above.</p>';
  } catch (err) {
    elements.matrixContainer.innerHTML = `<p class="empty">Error loading details: ${err.message}</p>`;
  }
}

function selectTask(taskId) {
  state.selectedTaskId = taskId;
  renderMatrix(state.teamState);
  renderChat(taskId);
}

async function refreshAll() {
  try {
    const jobs = await readJson('/v1/jobs?limit=50');
    renderJobList(jobs);
    if (!state.selectedJobId && jobs.length > 0) {
      selectJob(jobs[0].id);
    } else if (state.selectedJobId) {
      selectJob(state.selectedJobId);
    }
  } catch (err) {
    console.error('Failed to refresh:', err);
  }
}

elements.refreshNow.addEventListener('click', refreshAll);
elements.refreshSelected.addEventListener('click', () => state.selectedJobId && selectJob(state.selectedJobId));

// 초기 로드
refreshAll();

// 폴링 (주인님 요청대로 5분 이상 지연되지 않도록 5초마다 갱신)
setInterval(() => {
  refreshAll();
}, POLL_MS);
