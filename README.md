# A-Team Orchestration Server 🚀

TypeScript/NestJS 기반의 강력한 작업 오케스트레이션 시스템입니다. BullMQ와 tmux를 활용하여 멀티 에이전트 협업 및 복잡한 작업 파이프라인을 효율적으로 관리합니다.

## 🛠 Tech Stack
- **Runtime**: Node.js 20+ (TypeScript 5)
- **Framework**: NestJS (API), BullMQ (Queue Management)
- **State Management**: Redis (Shared Queue) or Local File Fallback
- **Orchestration**: tmux (Parallel worker execution & visualization)
- **Storage**: File-based job history (`.a-team/state/jobs`)

## 📂 Structure
- `services/api`: RESTful API 서버 (작업 등록 및 모니터링)
- `services/worker`: 실제 작업을 수행하는 워커 및 tmux 오케스트레이터
- `bin/`: `a-team` CLI 엔트리 포인트
- `skills/`: 에이전트가 활용 가능한 공용 스킬 셋
- `prompts/`: 에이전트별 특화 프롬프트 모음

## 🚀 Quick Start

### 1. 의존성 설치 및 초기화
```bash
npm install
# postinstall 스크립트가 자동으로 ~/.a-team 환경을 설정합니다.
```

### 2. 환경 설정
```bash
cp .env.example .env
# API 키 및 Redis 설정 확인
```

### 3. 로컬 개발 서버 실행 (API + Worker)
```bash
npm run dev:local
```
*서버 실행 후 `http://localhost:8080/monitor/`에서 실시간 팀 상태를 확인할 수 있습니다.*

## 🤖 Team Mode (Multi-Agent)
A-Team은 작업을 여러 에이전트에게 분배하고 tmux를 통해 병렬로 시각화하며 실행할 수 있습니다.

```bash
curl -X POST http://localhost:8080/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "codex",
    "mode": "team",
    "task": "복잡한 분석 작업을 팀 모드로 수행해줘",
    "options": {
      "team": { "tmuxVisualization": true }
    }
  }'
```

## 📜 Documentation
- [Reference Workflow](docs/REFERENCE_TEAM_WORKFLOW.md)
- [Codex Implementation Spec](docs/CODEX_TEAM_IMPLEMENTATION_SPEC.md)
- [TypeScript Operations Guide](docs/TYPESCRIPT_OPERATIONS.md)
