locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = var.aws_region

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
      # ── Lambda 호출 수 ──────────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0; y = 0; width = 12; height = 6
        properties = {
          title  = "Lambda 호출 수"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            for fn in local.fn_names : ["AWS/Lambda", "Invocations", "FunctionName", fn]
          ]
        }
      },
      # ── Lambda 에러 수 ──────────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 12; y = 0; width = 12; height = 6
        properties = {
          title  = "Lambda 에러 수"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            for fn in local.fn_names : ["AWS/Lambda", "Errors", "FunctionName", fn]
          ]
        }
      },
      # ── Lambda 평균 실행 시간 ────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0; y = 6; width = 12; height = 6
        properties = {
          title  = "Lambda 평균 실행 시간 (ms)"
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = local.region
          metrics = [
            for fn in local.fn_names : ["AWS/Lambda", "Duration", "FunctionName", fn]
          ]
        }
      },
      # ── Lambda Throttles ─────────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 12; y = 6; width = 12; height = 6
        properties = {
          title  = "Lambda 스로틀"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            for fn in local.fn_names : ["AWS/Lambda", "Throttles", "FunctionName", fn]
          ]
        }
      },
      # ── API Gateway HTTP 요청 수 ──────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0; y = 12; width = 8; height = 6
        properties = {
          title  = "HTTP API 요청 수"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.http.id]
          ]
        }
      },
      # ── API Gateway 4xx/5xx ────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 8; y = 12; width = 8; height = 6
        properties = {
          title  = "HTTP API 오류율"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/ApiGateway", "4xx", "ApiId", aws_apigatewayv2_api.http.id],
            ["AWS/ApiGateway", "5xx", "ApiId", aws_apigatewayv2_api.http.id],
          ]
        }
      },
      # ── API Gateway 응답 지연 ──────────────────────────────────────────────
      {
        type   = "metric"
        x      = 16; y = 12; width = 8; height = 6
        properties = {
          title  = "HTTP API 지연 (ms)"
          period = 300
          stat   = "Average"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/ApiGateway", "Latency", "ApiId", aws_apigatewayv2_api.http.id],
            ["AWS/ApiGateway", "IntegrationLatency", "ApiId", aws_apigatewayv2_api.http.id],
          ]
        }
      },
      # ── WebSocket 연결 수 ─────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 0; y = 18; width = 8; height = 6
        properties = {
          title  = "WebSocket 메시지 수"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/ApiGateway", "MessageCount", "ApiId", aws_apigatewayv2_api.ws.id]
          ]
        }
      },
      # ── DynamoDB 읽기/쓰기 ────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 8; y = 18; width = 8; height = 6
        properties = {
          title  = "DynamoDB 처리량"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/DynamoDB", "ConsumedReadCapacityUnits", "TableName", aws_dynamodb_table.casino.name],
            ["AWS/DynamoDB", "ConsumedWriteCapacityUnits", "TableName", aws_dynamodb_table.casino.name],
          ]
        }
      },
      # ── DynamoDB 에러 ────────────────────────────────────────────────────
      {
        type   = "metric"
        x      = 16; y = 18; width = 8; height = 6
        properties = {
          title  = "DynamoDB 오류"
          period = 300
          stat   = "Sum"
          view   = "timeSeries"
          region = local.region
          metrics = [
            ["AWS/DynamoDB", "UserErrors", "TableName", aws_dynamodb_table.casino.name],
            ["AWS/DynamoDB", "SystemErrors", "TableName", aws_dynamodb_table.casino.name],
          ]
        }
      },
    ]
  })
}

output "dashboard_url" {
  value = "https://${local.region}.console.aws.amazon.com/cloudwatch/home?region=${local.region}#dashboards:name=${aws_cloudwatch_dashboard.casino.dashboard_name}"
}
