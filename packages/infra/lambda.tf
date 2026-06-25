# ── Helper: Lambda 함수 생성 공통 설정 ───────────────────────────────────
locals {
  dist = "${path.module}/dist"
}

# ── WebSocket 핸들러 ──────────────────────────────────────────────────────

resource "aws_lambda_function" "ws_connect" {
  function_name    = "${local.prefix}-ws-connect"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/connect.zip"
  source_code_hash = filebase64sha256("${local.dist}/connect.zip")
  timeout          = 10
  environment { variables = local.lambda_env }
  tags = local.tags
}

resource "aws_lambda_function" "ws_disconnect" {
  function_name    = "${local.prefix}-ws-disconnect"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/disconnect.zip"
  source_code_hash = filebase64sha256("${local.dist}/disconnect.zip")
  timeout          = 30   # 10s grace period + DynamoDB cleanup operations
  environment { variables = local.lambda_env }
  tags = local.tags
}

resource "aws_lambda_function" "ws_default" {
  function_name    = "${local.prefix}-ws-default"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/default.zip"
  source_code_hash = filebase64sha256("${local.dist}/default.zip")
  timeout          = 29   # APIGW WebSocket integration 최대값
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── REST 핸들러 ───────────────────────────────────────────────────────────

resource "aws_lambda_function" "room_create" {
  function_name    = "${local.prefix}-room-create"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/create.zip"
  source_code_hash = filebase64sha256("${local.dist}/create.zip")
  timeout          = 10
  environment { variables = local.lambda_env }
  tags = local.tags
}

resource "aws_lambda_function" "room_join" {
  function_name    = "${local.prefix}-room-join"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/join.zip"
  source_code_hash = filebase64sha256("${local.dist}/join.zip")
  timeout          = 10
  environment { variables = local.lambda_env }
  tags = local.tags
}

resource "aws_lambda_function" "room_leave" {
  function_name    = "${local.prefix}-room-leave"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/leave.zip"
  source_code_hash = filebase64sha256("${local.dist}/leave.zip")
  timeout          = 10
  environment { variables = local.lambda_env }
  tags = local.tags
}

# ── Admin (모니터링) ──────────────────────────────────────────────────────

resource "aws_lambda_function" "room_janitor" {
  function_name    = "${local.prefix}-room-janitor"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/janitor.zip"
  source_code_hash = filebase64sha256("${local.dist}/janitor.zip")
  timeout          = 60
  environment { variables = local.janitor_env }
  tags = local.tags
}

resource "aws_lambda_function" "room_destroy" {
  function_name    = "${local.prefix}-room-destroy"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/destroy.zip"
  source_code_hash = filebase64sha256("${local.dist}/destroy.zip")
  timeout          = 15
  environment { variables = local.ws_admin_env }
  tags = local.tags
}

resource "aws_lambda_permission" "http_destroy" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_destroy.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

resource "aws_lambda_function" "room_costs" {
  function_name    = "${local.prefix}-room-costs"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/costs.zip"
  source_code_hash = filebase64sha256("${local.dist}/costs.zip")
  timeout          = 15
  environment { variables = local.admin_env }
  tags = local.tags
}

resource "aws_lambda_permission" "http_costs" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_costs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

resource "aws_lambda_function" "room_admin" {
  function_name    = "${local.prefix}-room-admin"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/admin.zip"
  source_code_hash = filebase64sha256("${local.dist}/admin.zip")
  timeout          = 10
  environment { variables = local.admin_env }
  tags = local.tags
}

resource "aws_lambda_permission" "http_admin" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_admin.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

# ── TTL Kick (DynamoDB Streams 트리거) ────────────────────────────────────

resource "aws_lambda_function" "ttl_kick" {
  function_name    = "${local.prefix}-ttl-kick"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/ttl-kick.zip"
  source_code_hash = filebase64sha256("${local.dist}/ttl-kick.zip")
  timeout          = 30
  environment {
    variables = merge(local.lambda_env, {
      WS_CALLBACK_URL = local.ws_callback_url
    })
  }
  tags = local.tags
}

resource "aws_lambda_event_source_mapping" "ttl_kick_stream" {
  event_source_arn  = aws_dynamodb_table.casino.stream_arn
  function_name     = aws_lambda_function.ttl_kick.arn
  starting_position = "LATEST"
  batch_size        = 20

  filter_criteria {
    filter {
      # REMOVE 이벤트(TTL 만료)만 처리
      pattern = jsonencode({ eventName = ["REMOVE"] })
    }
  }
}

# ── API Gateway → Lambda 실행 권한 ───────────────────────────────────────

resource "aws_lambda_permission" "ws_connect" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_connect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*"
}

resource "aws_lambda_permission" "ws_disconnect" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_disconnect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*"
}

resource "aws_lambda_permission" "ws_default" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_default.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*"
}

resource "aws_lambda_permission" "http_create" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_create.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

resource "aws_lambda_permission" "http_join" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_join.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

resource "aws_lambda_permission" "http_leave" {
  statement_id  = "AllowAPIGW"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_leave.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*"
}

# ── Discord Error Alert Lambda ────────────────────────────────────────────

resource "aws_lambda_function" "alert_discord" {
  function_name    = "${local.prefix}-alert-discord"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  filename         = "${local.dist}/alert.zip"
  source_code_hash = filebase64sha256("${local.dist}/alert.zip")
  timeout          = 15
  environment {
    variables = {
      DISCORD_WEBHOOK_URL = var.discord_webhook_url
    }
  }
  tags = local.tags
}

# CloudWatch Logs → alert Lambda 실행 권한
resource "aws_lambda_permission" "cwlogs_alert" {
  statement_id  = "AllowCloudWatchLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.alert_discord.function_name
  principal     = "logs.amazonaws.com"
  source_arn    = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.prefix}-*:*"
}

data "aws_caller_identity" "current" {}

# 모든 Lambda 로그 그룹 → alert Lambda 구독 필터
locals {
  monitored_functions = [
    aws_lambda_function.ws_connect.function_name,
    aws_lambda_function.ws_disconnect.function_name,
    aws_lambda_function.ws_default.function_name,
    aws_lambda_function.room_create.function_name,
    aws_lambda_function.room_join.function_name,
    aws_lambda_function.room_leave.function_name,
    aws_lambda_function.room_destroy.function_name,
    aws_lambda_function.room_janitor.function_name,
    aws_lambda_function.ttl_kick.function_name,
  ]
}

resource "aws_cloudwatch_log_subscription_filter" "alert" {
  for_each        = toset(local.monitored_functions)
  name            = "error-to-discord"
  log_group_name  = "/aws/lambda/${each.value}"
  filter_pattern  = "?ERROR ?Error ?\"Task timed out\""
  destination_arn = aws_lambda_function.alert_discord.arn
  depends_on      = [aws_lambda_permission.cwlogs_alert]
}
