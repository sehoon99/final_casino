resource "aws_iam_role" "lambda" {
  name = "${local.prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_main" {
  name = "${local.prefix}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # DynamoDB CRUD + Streams
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
          "dynamodb:Query", "dynamodb:Scan", "dynamodb:TransactWriteItems", "dynamodb:BatchWriteItem",
          "dynamodb:GetRecords", "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream", "dynamodb:ListStreams",
        ]
        Resource = [
          aws_dynamodb_table.casino.arn,
          "${aws_dynamodb_table.casino.arn}/stream/*",
          "${aws_dynamodb_table.casino.arn}/index/*",
        ]
      },
      {
        # WebSocket 메시지 전송 (broadcastToRoom)
        Effect   = "Allow"
        Action   = ["execute-api:ManageConnections"]
        Resource = "${aws_apigatewayv2_api.ws.execution_arn}/*/*/@connections/*"
      },
      {
        # EventBridge 이벤트 발행
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.casino.arn
      },
      {
        # AWS 비용 조회 (Cost Explorer — 리소스 레벨 권한 미지원)
        Effect   = "Allow"
        Action   = ["ce:GetCostAndUsage"]
        Resource = "*"
      },
    ]
  })
}
