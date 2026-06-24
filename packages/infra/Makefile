.PHONY: build plan apply destroy

# 1단계: Lambda 번들 빌드
build:
	bash build.sh

# 2단계: 변경사항 미리보기
plan: build
	terraform plan -out=tfplan

# 3단계: 실제 배포
apply: build
	terraform apply tfplan

# 프론트엔드만 재배포 (Lambda 코드 변경 없을 때)
deploy-frontend:
	terraform apply -target=aws_s3_object.index_html -target=aws_s3_object.config_js -auto-approve

# 전체 삭제 (주의!)
destroy:
	terraform destroy
