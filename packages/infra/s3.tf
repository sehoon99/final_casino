# ── S3 버킷 (정적 파일) ───────────────────────────────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "${local.prefix}-frontend-${data.aws_caller_identity.current.account_id}"
  tags   = local.tags
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_caller_identity" "current" {}

# ── CloudFront OAC ────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.prefix}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.frontend.arn
        }
      }
    }]
  })
}

# ── CloudFront Distribution ───────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  enabled             = true
  default_root_object = "index.html"
  comment             = "${local.prefix} frontend"

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    min_ttl     = 0
    default_ttl = 60    # config.js 변경 빠르게 반영
    max_ttl     = 300
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = local.tags
}

# ── 정적 파일 업로드 ──────────────────────────────────────────────────────

resource "aws_s3_object" "index_html" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "index.html"
  source       = "${path.root}/../../test-ui.html"
  content_type = "text/html; charset=utf-8"
  etag         = filemd5("${path.root}/../../test-ui.html")
}

resource "aws_s3_object" "admin_html" {
  bucket       = aws_s3_bucket.frontend.id
  key          = "admin.html"
  source       = "${path.root}/admin.html"
  content_type = "text/html; charset=utf-8"
  etag         = filemd5("${path.root}/admin.html")
}

# API URL 주입 — 브라우저가 window.__CASINO_CONFIG__를 읽어 사용
resource "aws_s3_object" "config_js" {
  bucket  = aws_s3_bucket.frontend.id
  key     = "config.js"
  content = <<-JS
    window.__CASINO_CONFIG__ = {
      api: "${aws_apigatewayv2_stage.http.invoke_url}",
      ws:  "${aws_apigatewayv2_api.ws.api_endpoint}/${var.env}"
    };
  JS
  content_type = "application/javascript; charset=utf-8"
}
