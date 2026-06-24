terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
  backend "s3" {
    bucket = "casino-tfstate-097852546028"
    key    = "casino/terraform.tfstate"
    region = "ap-northeast-2"
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  prefix = "${var.project}-${var.env}"
  tags = {
    Environment = var.env
    Service     = var.project
    ManagedBy   = "terraform"
    Team        = "casino"
  }

  # Lambda 공통 환경변수
  lambda_env = {
    TABLE_NAME     = aws_dynamodb_table.casino.name
    EVENT_BUS_NAME = aws_cloudwatch_event_bus.casino.name
  }

  # Admin 전용 환경변수 (공통 + 토큰)
  admin_env = merge(local.lambda_env, {
    ADMIN_TOKEN = var.admin_token
  })

  # Destroy/Janitor 전용 (admin + WS callback)
  ws_admin_env = merge(local.admin_env, {
    WS_CALLBACK_URL = local.ws_callback_url
  })

  # Janitor 전용 (WS callback만, 토큰 불필요)
  janitor_env = merge(local.lambda_env, {
    WS_CALLBACK_URL = local.ws_callback_url
  })

  # WebSocket callback URL (APIGW management API endpoint)
  ws_callback_url = "https://${aws_apigatewayv2_api.ws.id}.execute-api.${var.aws_region}.amazonaws.com/${var.env}"
}
