import { Box } from '@mui/material';
import packageJson from '../../../package.json';

const Version = () => {
  const curVersion = import.meta.env.VITE_APP_VERSION || packageJson.version;

  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        pt: 2,
        mt: 1,
        color: 'text.tertiary',
        fontSize: 12,
        lineHeight: 1,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      v{curVersion}
    </Box>
  );
};

export default Version;
