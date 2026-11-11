import UploadFile from '@/components/UploadFile';
import { getSiteBrand, updateSiteBrand } from '@/request/Site';
import { useAppDispatch } from '@/store';
import { setSiteBrand } from '@/store/slices/config';
import { Box, Button, Stack, TextField } from '@mui/material';
import { message } from '@ctzhian/ui';
import { useEffect, useState } from 'react';

const Brand = () => {
  const dispatch = useAppDispatch();
  const [siteName, setSiteName] = useState('');
  const [siteIcon, setSiteIcon] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    getSiteBrand()
      .then(res => {
        setSiteName(res.site_name || '');
        setSiteIcon(res.site_icon || '');
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  const handleSave = () => {
    const name = siteName.trim();
    if (!name) {
      message.error('站点名称不能为空');
      return;
    }
    setLoading(true);
    updateSiteBrand({ site_name: name, site_icon: siteIcon })
      .then(res => {
        dispatch(setSiteBrand(res));
        message.success('保存成功');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  return (
    <Stack gap={3} sx={{ maxWidth: 560, pt: 1 }}>
      <Stack direction='row' alignItems='center' gap={2}>
        <Box sx={{ width: 100, flexShrink: 0, fontSize: 14 }}>站点名称</Box>
        <TextField
          size='small'
          fullWidth
          value={siteName}
          disabled={fetching}
          placeholder='显示在登录页与侧边栏'
          onChange={e => setSiteName(e.target.value)}
        />
      </Stack>

      <Stack direction='row' alignItems='flex-start' gap={2}>
        <Box
          sx={{ width: 100, flexShrink: 0, fontSize: 14, lineHeight: '40px' }}
        >
          站点头像
        </Box>
        <Box>
          <UploadFile
            id='site-icon'
            name='site-icon'
            type='url'
            accept='image/*'
            value={siteIcon}
            width={80}
            height={80}
            label='上传头像'
            onChange={url => setSiteIcon(url)}
          />
          <Box sx={{ mt: 1, fontSize: 12, color: 'text.tertiary' }}>
            建议正方形图片，支持 PNG / JPG / SVG
          </Box>
        </Box>
      </Stack>

      <Stack direction='row' gap={2} sx={{ pl: '108px' }}>
        <Button
          variant='contained'
          size='small'
          loading={loading}
          onClick={handleSave}
        >
          保存
        </Button>
        <Button
          size='small'
          disabled={fetching}
          onClick={() => {
            getSiteBrand()
              .then(res => {
                setSiteName(res.site_name || '');
                setSiteIcon(res.site_icon || '');
              })
              .catch(() => {});
          }}
        >
          重置
        </Button>
      </Stack>
    </Stack>
  );
};

export default Brand;
