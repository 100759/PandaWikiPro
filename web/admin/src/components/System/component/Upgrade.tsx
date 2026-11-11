import { getSiteVersion, VersionInfo } from '@/request/Site';
import { Box, Button, Stack, Typography } from '@mui/material';
import { message } from '@ctzhian/ui';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

// 从 GitHub 拉取最新版本，领先当前版本时给出升级指引
const Version = () => {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const check = (silent = false) => {
    setLoading(true);
    getSiteVersion()
      .then(res => {
        setInfo(res);
        if (!silent) {
          if (res.has_update) {
            message.success(`检测到新版本 ${res.latest}`);
          } else {
            message.success('已是最新版本');
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    check(true);
  }, []);

  return (
    <Stack gap={3} sx={{ maxWidth: 640, pt: 1 }}>
      <Stack direction='row' alignItems='center' gap={2}>
        <Box sx={{ width: 100, flexShrink: 0, fontSize: 14 }}>当前版本</Box>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
          {info?.current || '-'}
        </Typography>
      </Stack>

      <Stack direction='row' alignItems='center' gap={2}>
        <Box sx={{ width: 100, flexShrink: 0, fontSize: 14 }}>最新版本</Box>
        <Stack direction='row' alignItems='center' gap={1.5}>
          <Typography sx={{ fontSize: 14 }}>
            {info?.latest || '获取失败'}
          </Typography>
          {info?.has_update ? (
            <Box
              sx={{
                px: 1,
                py: '1px',
                borderRadius: '10px',
                fontSize: 12,
                lineHeight: '18px',
                color: 'warning.contrastText',
                bgcolor: 'warning.main',
              }}
            >
              有新版本
            </Box>
          ) : info?.latest ? (
            <Box sx={{ fontSize: 12, color: 'text.tertiary' }}>
              已是最新版本
            </Box>
          ) : null}
        </Stack>
      </Stack>

      <Stack direction='row' alignItems='center' gap={2}>
        <Box sx={{ width: 100, flexShrink: 0, fontSize: 14 }}>更新源</Box>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          {info?.repo || '-'}
        </Typography>
      </Stack>

      {info?.checked_at && (
        <Stack direction='row' alignItems='center' gap={2}>
          <Box sx={{ width: 100, flexShrink: 0, fontSize: 14 }}>检查时间</Box>
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {dayjs(info.checked_at).format('YYYY-MM-DD HH:mm:ss')}
          </Typography>
        </Stack>
      )}

      <Stack direction='row' gap={2} sx={{ pl: '108px' }}>
        <Button
          variant='outlined'
          size='small'
          loading={loading}
          onClick={() => check()}
        >
          检查更新
        </Button>
        <Button
          size='small'
          disabled={!info?.has_update || !info?.release_url}
          onClick={() => window.open(info!.release_url, '_blank')}
        >
          前往发布页
        </Button>
      </Stack>

      <Box
        sx={{
          pl: '108px',
          fontSize: 12,
          color: 'text.tertiary',
          lineHeight: 1.8,
        }}
      >
        升级方式：在服务器上执行 <code>git pull</code>{' '}
        拉取最新代码后重新构建镜像；
        或直接拉取新版镜像替换。可先在发布页查看该版本的变更说明。
      </Box>
    </Stack>
  );
};

export default Version;
