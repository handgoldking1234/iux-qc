/* ScanQC Web 설정
   Supabase 를 연결하면 로그인 · 팀 작업 · 사용 통계가 켜집니다.
   비워 두면 '내 PC 폴더' 검수만 동작합니다 (그것만으로도 모든 보정 기능 사용 가능).
   값은 Supabase 대시보드 → Project Settings → API 에서 복사하세요. (anon public 키는 공개돼도 되는 키입니다) */
window.SCANQC_CONFIG = {
  supabaseUrl: '',   // 예) 'https://abcdefgh.supabase.co'
  supabaseKey: ''    // 예) 'eyJhbGciOi...' (anon public key)
};
