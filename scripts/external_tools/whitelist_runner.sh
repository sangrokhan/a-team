#!/bin/bash
# A-Team 화이트리스트 도구 실행기
TOOL_NAME=$1
shift
PARAMS=$@

case $TOOL_NAME in
  "backtest")
    python3 scripts/backtest.py $PARAMS
    ;;
  "analyze-data")
    python3 scripts/data_analyzer.py $PARAMS
    ;;
  *)
    echo "Error: Tool '$TOOL_NAME' is not in the whitelist."
    exit 1
    ;;
esac
