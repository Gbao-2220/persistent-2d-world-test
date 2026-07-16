# 지속 저장 2D 월드 테스트 평면 업로드판

이 버전은 폴더 없이 다섯 파일만으로 구성되어 있습니다. GitHub 웹의 Upload files 화면에서 다섯 파일을 한꺼번에 선택하면 됩니다.

## GitHub에 올릴 파일

- index.html
- worker.js
- wrangler.jsonc
- package.json
- README.md

## Cloudflare 설정

- Worker 이름: persistent-2d-world-test
- Production branch: main
- Build command: 비워 두기
- Deploy command: npx wrangler deploy
- Root directory: 비워 두기

배포 주소를 일반 창과 시크릿 창에서 동시에 열어 실시간 이동과 색칠을 확인합니다. 모든 창을 닫았다가 재접속했을 때 색칠한 타일이 남아 있으면 서버 자동 저장이 정상적으로 작동한 것입니다.

