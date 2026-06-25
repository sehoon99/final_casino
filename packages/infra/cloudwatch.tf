locals {
  region = var.aws_region

  # Lambda 함수 이름 목록 (대시보드 위젯용)
  fn_names = [
    "${local.prefix}-ws-connect",
    "${local.prefix}-ws-disconnect",
    "${local.prefix}-ws-default",
    "${local.prefix}-room-create",
    "${local.prefix}-room-join",
    "${local.prefix}-room-leave",
    "${local.prefix}-room-destroy",
    "${local.prefix}-room-janitor",
    "${local.prefix}-ttl-kick",
    "${local.prefix}-alert-discord",
  ]
}

resource "aws_cloudwatch_dashboard" "casino" {
  dashboard_name = "${local.prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      # ── Lambda 호출 수 ─────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda 호출 수"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [for fn in local.fn_names : ["AWS/Lambda", "Invocations", "FunctionName", fn]]
        }
      },
      # ── Lambda 에러 수 ─────────────────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda 에러 수"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [for fn in local.fn_names : ["AWS/Lambda", "Errors", "FunctionName", fn]]
        }
      },
      # ── Lambda 평균 실행 시간 ──────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Lambda 평균 실행 시간 (ms)"
          period  = 300
          stat    = "Average"
          view    = "timeSeries"
          region  = local.region
          metrics = [for fn in local.fn_names : ["AWS/Lambda", "Duration", "FunctionName", fn]]
        }
      },
      # ── Lambda Throttles ───────────────────────────────────────────
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Lambda 스로틀"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [for fn in local.fn_names : ["AWS/Lambda", "Throttles", "FunctionName", fn]]
        }
      },
      # ── API Gateway HTTP 요청 수 ────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 12
        width  = 8
        height = 6
        properties = {
          title   = "HTTP API 요청 수"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.http.id]]
        }
      },
      # ── API Gateway 4xx/5xx ────────────────────────────────────────
      {
        type   = "metric"
        x      = 8
        y      = 12
        width  = 8
        height = 6
        properties = {
          title   = "HTTP API 오류율"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [
            ["AWS/ApiGateway", "4xx", "ApiId", aws_apigatewayv2_api.http.id],
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.http.id],
          ]
        }
      },
      # ── API Gateway 응답 지연 ──────────────────────────────────────
      {
        type   = "metric"
        x      = 16
        y      = 12
        width  = 8
        height = 6
        properties = {
          title   = "HTTP API 지연 (ms)"
          period  = 300
          stat    = "Average"
          view    = "timeSeries"
          region  = local.region
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.http.id],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", aws_apigatewayv2_api.http.id],
          ]
        }
      },
      # ── WebSocket 메시지 수 ────────────────────────────────────────
      {
        type   = "metric"
        x      = 0
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "WebSocket 메시지 수"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [["AWS/ApiGateway", "MessageCount", "ApiId", aws_apigatewayv2_api.ws.id]]
        }
      },
      # ── DynamoDB 읽기/쓰기 ─────────────────────────────────────────
      {
        type   = "metric"
        x      = 8
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "DynamoDB 처리량"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", aws_dynamodb_table.casino.name],
            ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", aws_dynamodb_table.casino.name],
          ]
        }
      },
      # ── DynamoDB 에러 ──────────────────────────────────────────────
      {
        type   = "metric"
        x      = 16
        y      = 18
        width  = 8
        height = 6
        properties = {
          title   = "DynamoDB 오류"
          period  = 300
          stat    = "Sum"
          view    = "timeSeries"
          region  = local.region
          metrics = [
            ["AWS/DynamoDB", "UserErrors", "TableName", aws_dynamodb_table.casino.name],
            ["AWS/DynamoDB", "SystemErrors", "TableName", aws_dynamodb_table.casino.name],
          ]
        }
      },

      # ══ 사용자 분석 (Logs Insights) ══════════════════════════════════

      {
        type   = "text"
        x      = 0
        y      = 24
        width  = 24
        height = 1
        properties = { markdown = "## 📊 사용자 분석" }
      },
      # ── DAU ───────────────────────────────────────────────────────
      {
        type   = "log"
        x      = 0
        y      = 25
        width  = 8
        height = 6
        properties = {
          title  = "DAU (일별 고유 사용자)"
          region = local.region
          view   = "bar"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-connect' | filter level = \"METRIC\" and message = \"session_start\" | stats count_distinct(userId) as dau by bin(1d)"
        }
      },
      # ── 시간대별 접속 ──────────────────────────────────────────────
      {
        type   = "log"
        x      = 8
        y      = 25
        width  = 8
        height = 6
        properties = {
          title  = "시간대별 접속 분포"
          region = local.region
          view   = "bar"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-connect' | filter level = \"METRIC\" and message = \"session_start\" | stats count(*) as sessions by bin(1h)"
        }
      },
      # ── 국가별 접속 TOP 10 ─────────────────────────────────────────
      {
        type   = "log"
        x      = 16
        y      = 25
        width  = 8
        height = 6
        properties = {
          title  = "국가별 접속 TOP 10"
          region = local.region
          view   = "table"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-connect' | filter level = \"METRIC\" and message = \"session_start\" and ispresent(countryCode) | stats count(*) as sessions by countryCode, country | sort sessions desc | limit 10"
        }
      },
      # ── 게임별 플레이 횟수 ─────────────────────────────────────────
      {
        type   = "log"
        x      = 0
        y      = 31
        width  = 8
        height = 6
        properties = {
          title  = "게임별 플레이 횟수"
          region = local.region
          view   = "pie"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-default' | filter level = \"METRIC\" and message = \"game_start\" | stats count(*) as plays by gameId | sort plays desc"
        }
      },
      # ── 평균 세션 길이 ─────────────────────────────────────────────
      {
        type   = "log"
        x      = 8
        y      = 31
        width  = 8
        height = 6
        properties = {
          title  = "평균 세션 길이 (초)"
          region = local.region
          view   = "table"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-disconnect' | filter level = \"METRIC\" and message = \"session_end\" and ispresent(sessionSec) | stats avg(sessionSec) as avgSec, max(sessionSec) as maxSec, count(*) as sessions"
        }
      },
      # ── 방 생성 추이 ───────────────────────────────────────────────
      {
        type   = "log"
        x      = 16
        y      = 31
        width  = 8
        height = 6
        properties = {
          title  = "방 생성 추이 (일별)"
          region = local.region
          view   = "bar"
          query  = "SOURCE '/aws/lambda/${local.prefix}-room-create' | filter level = \"METRIC\" and message = \"room_create\" | stats count(*) as rooms by bin(1d)"
        }
      },
      # ── WAU ───────────────────────────────────────────────────────
      {
        type   = "log"
        x      = 0
        y      = 37
        width  = 12
        height = 6
        properties = {
          title  = "WAU (주간 고유 사용자)"
          region = local.region
          view   = "bar"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-connect' | filter level = \"METRIC\" and message = \"session_start\" | stats count_distinct(userId) as wau by bin(7d)"
        }
      },
      # ── 에러 추이 ─────────────────────────────────────────────────
      {
        type   = "log"
        x      = 12
        y      = 37
        width  = 12
        height = 6
        properties = {
          title  = "에러 발생 추이 (일별)"
          region = local.region
          view   = "bar"
          query  = "SOURCE '/aws/lambda/${local.prefix}-ws-connect', '/aws/lambda/${local.prefix}-ws-default', '/aws/lambda/${local.prefix}-ws-disconnect' | filter level = \"ERROR\" | stats count(*) as errors by bin(1d)"
        }
      },
    ]
  })
}

output "dashboard_url" {
  value = "https://${local.region}.console.aws.amazon.com/cloudwatch/home?region=${local.region}#dashboards:name=${aws_cloudwatch_dashboard.casino.dashboard_name}"
}
