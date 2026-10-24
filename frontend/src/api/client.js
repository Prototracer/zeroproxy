
const API_BASE_URL = 'http://localhost:5000';

export async function apiRequest(endpoint, options = {}) {
  const token = sessionStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      'Unable to connect to the server. Please check whether the backend is running.'
    );
  }

  const contentType = response.headers.get('content-type');
  let data = null;

  if (contentType && contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    data = await response.text().catch(() => null);
  }

  if (!response.ok) {
    const serverMessage =
      typeof data === 'object' && data !== null
        ? data.detail || data.message || data.error
        : null;

    if (response.status === 401) {
      sessionStorage.removeItem('token');
      sessionStorage.removeItem('isLoggedIn');

      throw new Error(
        serverMessage || 'Session expired or unauthorized. Please log in again.'
      );
    }

    if (response.status === 403) {
      throw new Error(
        serverMessage || 'You do not have permission to perform this action.'
      );
    }

    throw new Error(
      serverMessage || `Request failed with status ${response.status}.`
    );
  }

  return data;
}