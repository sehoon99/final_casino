output "frontend_url" {
  description = "게임 접속 URL"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "api_url" {
  description = "REST API 엔드포인트"
  value       = aws_apigatewayv2_stage.http.invoke_url
}

output "ws_url" {
  description = "WebSocket 엔드포인트"
  value       = "${aws_apigatewayv2_api.ws.api_endpoint}/${var.env}"
}

output "admin_url" {
  description = "어드민 모니터링 페이지"
  value       = "https://${aws_cloudfront_distribution.frontend.domain_name}/admin.html"
}

output "dynamodb_table" {
  description = "DynamoDB 테이블명"
  value       = aws_dynamodb_table.casino.name
}
