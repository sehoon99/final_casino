resource "aws_dynamodb_table" "casino" {
  name         = "${local.prefix}-table"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # Streams → TTL kick Lambda
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = local.tags
}

# EventBridge custom bus (ROOM_CREATED, PLAYER_JOINED 등)
resource "aws_cloudwatch_event_bus" "casino" {
  name = "${local.prefix}-bus"
  tags = local.tags
}
