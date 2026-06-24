# ── Janitor — 5분마다 비활성 방 정리 ─────────────────────────────────────

resource "aws_cloudwatch_event_rule" "janitor" {
  name                = "${local.prefix}-janitor"
  description         = "30분 이상 비활성 방 자동 삭제"
  schedule_expression = "rate(5 minutes)"
  tags                = local.tags
}

resource "aws_cloudwatch_event_target" "janitor" {
  rule = aws_cloudwatch_event_rule.janitor.name
  arn  = aws_lambda_function.room_janitor.arn
}

resource "aws_lambda_permission" "janitor_events" {
  statement_id  = "AllowEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.room_janitor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.janitor.arn
}
