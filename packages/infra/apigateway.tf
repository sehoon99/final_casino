# ══════════════════════════════════════════════════════════════════════════
# WebSocket API (게임 실시간 통신)
# ══════════════════════════════════════════════════════════════════════════

resource "aws_apigatewayv2_api" "ws" {
  name                       = "${local.prefix}-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
  tags                       = local.tags
}

# $connect 라우트
resource "aws_apigatewayv2_integration" "ws_connect" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = aws_lambda_function.ws_connect.invoke_arn
  content_handling_strategy = "CONVERT_TO_TEXT"
}
resource "aws_apigatewayv2_route" "ws_connect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_connect.id}"
}

# $disconnect 라우트
resource "aws_apigatewayv2_integration" "ws_disconnect" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = aws_lambda_function.ws_disconnect.invoke_arn
  content_handling_strategy = "CONVERT_TO_TEXT"
}
resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_disconnect.id}"
}

# $default 라우트 (모든 메시지: PING, CHAT, START_GAME, GAME_ACTION)
resource "aws_apigatewayv2_integration" "ws_default" {
  api_id                    = aws_apigatewayv2_api.ws.id
  integration_type          = "AWS_PROXY"
  integration_uri           = aws_lambda_function.ws_default.invoke_arn
  content_handling_strategy = "CONVERT_TO_TEXT"
}
resource "aws_apigatewayv2_route" "ws_default" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ws_default.id}"
}

resource "aws_apigatewayv2_stage" "ws" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = var.env
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  tags = local.tags
}

# ══════════════════════════════════════════════════════════════════════════
# HTTP API (방 생성/참가/나가기 REST)
# ══════════════════════════════════════════════════════════════════════════

resource "aws_apigatewayv2_api" "http" {
  name          = "${local.prefix}-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "x-admin-token"]
    max_age       = 86400
  }

  tags = local.tags
}

# POST /rooms
resource "aws_apigatewayv2_integration" "http_create" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.room_create.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_create" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /rooms"
  target    = "integrations/${aws_apigatewayv2_integration.http_create.id}"
}

# POST /rooms/{roomId}/join
resource "aws_apigatewayv2_integration" "http_join" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.room_join.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_join" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /rooms/{roomId}/join"
  target    = "integrations/${aws_apigatewayv2_integration.http_join.id}"
}

# DELETE /admin/rooms/{roomId}
resource "aws_apigatewayv2_integration" "http_destroy" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.room_destroy.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_destroy" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "DELETE /admin/rooms/{roomId}"
  target    = "integrations/${aws_apigatewayv2_integration.http_destroy.id}"
}

# GET /admin/costs
resource "aws_apigatewayv2_integration" "http_costs" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.room_costs.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_costs" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /admin/costs"
  target    = "integrations/${aws_apigatewayv2_integration.http_costs.id}"
}

# GET /admin/rooms
resource "aws_apigatewayv2_integration" "http_admin" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.room_admin.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_admin" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /admin/rooms"
  target    = "integrations/${aws_apigatewayv2_integration.http_admin.id}"
}

# POST /rooms/{roomId}/leave
resource "aws_apigatewayv2_integration" "http_leave" {
  api_id             = aws_apigatewayv2_api.http.id
  integration_type   = "AWS_PROXY"
  integration_uri    = aws_lambda_function.room_leave.invoke_arn
  payload_format_version = "2.0"
}
resource "aws_apigatewayv2_route" "http_leave" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "POST /rooms/{roomId}/leave"
  target    = "integrations/${aws_apigatewayv2_integration.http_leave.id}"
}

resource "aws_apigatewayv2_stage" "http" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}
