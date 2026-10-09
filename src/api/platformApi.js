import client from './client'

// The platform owner's hospitals — answered by backend/src/controllers/platformController.js
// and open to the platform_owner role alone. The list is paged with
// useServerPagination (PLATFORM_ENDPOINT, { search }); each row carries what the
// hospital has bought (modulesAllowed; null = no limit yet) and what its
// administrator keeps on (modulesEnabled).

export const PLATFORM_ENDPOINT = '/platform/hospitals'

export const platformApi = {
  create: (body)     => client.post(PLATFORM_ENDPOINT, body),             // hospital + its first administrator → the new row
  update: (id, body) => client.patch(`${PLATFORM_ENDPOINT}/${id}`, body), // plan, modules bought, on/off → the updated row
}
