import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor to attach JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('markaz_admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle token expiration (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // If unauthorized and currently in admin panel, clear token and redirect to login
      if (window.location.pathname.startsWith('/admin') && window.location.pathname !== '/admin/login') {
        localStorage.removeItem('markaz_admin_token');
        localStorage.removeItem('markaz_admin_user');
        window.location.href = '/admin/login?expired=1';
      }
    }
    return Promise.reject(error);
  }
);

// Download a protected file (Excel/CSV export). A plain link or window.open can't send the
// Authorization header, so fetch it through the API client and save the blob instead.
export async function downloadFile(url, fallbackName = 'download') {
  try {
    const res = await api.get(url, { responseType: 'blob' });
    const disposition = res.headers['content-disposition'] || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : fallbackName;

    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  } catch (err) {
    // Error bodies arrive as a Blob because of responseType: 'blob'
    let message = 'Failed to download file.';
    try {
      const body = JSON.parse(await err.response.data.text());
      if (body.message) message = body.message;
    } catch {
      // Keep the generic message
    }
    alert(message);
  }
}

export default api;
