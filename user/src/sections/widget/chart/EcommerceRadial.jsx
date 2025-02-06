import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';

// material-ui
import { alpha, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// third-party
import ReactApexChart from 'react-apexcharts';

// project-imports
import MainCard from 'components/MainCard';
import { ThemeMode } from 'config';

// ==============================|| CHART ||============================== //

function EcommerceDataChart({ count, color }) {
  const theme = useTheme();
  const mode = theme.palette.mode;

  // chart options
  const areaChartOptions = {
    chart: {
      id: 'new-stack-chart',
      type: 'radialBar'
    },
    plotOptions: {
      radialBar: {
        hollow: {
          margin: 0,
          size: '60%',
          background: 'transparent',
          imageOffsetX: 0,
          imageOffsetY: 0,
          position: 'front'
        },
        track: {
          background: alpha(color, 0.5),
          strokeWidth: '50%'
        },

        dataLabels: {
          show: true,
          name: {
            show: false
          },
          value: {
            formatter: (val) => val,
            offsetY: 7,
            color: color,
            fontSize: '20px',
            fontWeight: '700',
            show: true
          }
        }
      }
    }
  };

  const { primary, secondary } = theme.palette.text;
  const line = theme.palette.divider;

  const [options, setOptions] = useState(areaChartOptions);

  useEffect(() => {
    setOptions((prevState) => ({
      ...prevState,
      colors: [color],
      theme: {
        mode: mode === ThemeMode.DARK ? 'dark' : 'light'
      }
    }));
  }, [color, mode, primary, secondary, line, theme]);


  return <ReactApexChart options={options} series={[count]} type="radialBar" height={120} />;
}

// ==============================|| CHART WIDGET - ECOMMERCE RADIAL  ||============================== //

export default function EcommerceRadial({count, color }) {
  return (
    <MainCard content={false}>
      <Stack direction="row" alignItems="center" spacing={2} sx={{ px: 2 }}>
        <Box sx={{ width: 120 }}>
          <EcommerceDataChart count={count} color={color} />
        </Box>
        <Stack>
          <Typography>Total Stacked ICO</Typography>
          <Typography variant="subtitle1">{count} RBM</Typography>
        </Stack>
      </Stack>
    </MainCard>
  );
}

EcommerceDataChart.propTypes = { color: PropTypes.string };

EcommerceRadial.propTypes = { color: PropTypes.string };
