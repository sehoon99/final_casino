variable "aws_region" {
  type    = string
  default = "ap-northeast-2"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "project" {
  type    = string
  default = "casino-night"
}

variable "admin_token" {
  description = "Admin page access token (비밀번호)"
  type        = string
  default     = "casino159"
  sensitive   = true
}

variable "discord_webhook_url" {
  description = "Discord webhook URL for error alerts"
  type        = string
  default     = ""
  sensitive   = true
}
