-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Use the actual MeshCore token as the stable name of built-in regions.
-- The # prefix belongs only to transport-key derivation. Preserve existing
-- packet, node and observer associations when upgrading configured scopes.
-- This fixed list is the non-wildcard catalogue at introduction (2026-09-26).
DO $$
DECLARE
  token TEXT;
  legacy_id INT;
  canonical_id INT;
BEGIN
  FOREACH token IN ARRAY ARRAY[
    'se', 'offgrid', 'se01', 'se0114', 'se0115', 'se0117', 'se0120', 'se0123', 'se0125', 'se0126',
    'se0127', 'se0128', 'se0136', 'se0138', 'se0139', 'se0140', 'se0160', 'se0162', 'se0163', 'se0180',
    'se0181', 'se0182', 'se0183', 'se0184', 'se0186', 'se0187', 'se0188', 'se0191', 'se0192', 'se03',
    'se0305', 'se0319', 'se0330', 'se0331', 'se0360', 'se0380', 'se0381', 'se0382', 'se04', 'se0428',
    'se0461', 'se0480', 'se0481', 'se0482', 'se0483', 'se0484', 'se0486', 'se0488', 'se05', 'se0509',
    'se0512', 'se0513', 'se0560', 'se0561', 'se0562', 'se0563', 'se0580', 'se0581', 'se0582', 'se0583',
    'se0584', 'se0586', 'se06', 'se0604', 'se0617', 'se0642', 'se0643', 'se0662', 'se0665', 'se0680',
    'se0682', 'se0683', 'se0684', 'se0685', 'se0686', 'se0687', 'se07', 'se0760', 'se0761', 'se0763',
    'se0764', 'se0765', 'se0767', 'se0780', 'se0781', 'se08', 'se0821', 'se0834', 'se0840', 'se0860',
    'se0861', 'se0862', 'se0880', 'se0881', 'se0882', 'se0883', 'se0884', 'se0885', 'se09', 'se0980',
    'se10', 'se1060', 'se1080', 'se1081', 'se1082', 'se1083', 'se12', 'se1214', 'se1230', 'se1231',
    'se1233', 'se1256', 'se1257', 'se1260', 'se1261', 'se1262', 'se1263', 'se1264', 'se1265', 'se1266',
    'se1267', 'se1270', 'se1272', 'se1273', 'se1275', 'se1276', 'se1277', 'se1278', 'se1280', 'se1281',
    'se1282', 'se1283', 'se1284', 'se1285', 'se1286', 'se1287', 'se1290', 'se1291', 'se1292', 'se1293',
    'se13', 'se1315', 'se1380', 'se1381', 'se1382', 'se1383', 'se1384', 'se14', 'se1401', 'se1402',
    'se1407', 'se1415', 'se1419', 'se1421', 'se1427', 'se1430', 'se1435', 'se1438', 'se1439', 'se1440',
    'se1441', 'se1442', 'se1443', 'se1444', 'se1445', 'se1446', 'se1447', 'se1452', 'se1460', 'se1461',
    'se1462', 'se1463', 'se1465', 'se1466', 'se1470', 'se1471', 'se1472', 'se1473', 'se1480', 'se1481',
    'se1482', 'se1484', 'se1485', 'se1486', 'se1487', 'se1488', 'se1489', 'se1490', 'se1491', 'se1492',
    'se1493', 'se1494', 'se1495', 'se1496', 'se1497', 'se1498', 'se1499', 'se17', 'se1715', 'se1730',
    'se1737', 'se1760', 'se1761', 'se1762', 'se1763', 'se1764', 'se1765', 'se1766', 'se1780', 'se1781',
    'se1782', 'se1783', 'se1784', 'se1785', 'se18', 'se1814', 'se1860', 'se1861', 'se1862', 'se1863',
    'se1864', 'se1880', 'se1881', 'se1882', 'se1883', 'se1884', 'se1885', 'se19', 'se1904', 'se1907',
    'se1960', 'se1961', 'se1962', 'se1980', 'se1981', 'se1982', 'se1983', 'se1984', 'se20', 'se2021',
    'se2023', 'se2026', 'se2029', 'se2031', 'se2034', 'se2039', 'se2061', 'se2062', 'se2080', 'se2081',
    'se2082', 'se2083', 'se2084', 'se2085', 'se21', 'se2101', 'se2104', 'se2121', 'se2132', 'se2161',
    'se2180', 'se2181', 'se2182', 'se2183', 'se2184', 'se22', 'se2260', 'se2262', 'se2280', 'se2281',
    'se2282', 'se2283', 'se2284', 'se23', 'se2303', 'se2305', 'se2309', 'se2313', 'se2321', 'se2326',
    'se2361', 'se2380', 'se24', 'se2401', 'se2403', 'se2404', 'se2409', 'se2417', 'se2418', 'se2421',
    'se2422', 'se2425', 'se2460', 'se2462', 'se2463', 'se2480', 'se2481', 'se2482', 'se25', 'se2505',
    'se2506', 'se2510', 'se2513', 'se2514', 'se2518', 'se2521', 'se2523', 'se2560', 'se2580', 'se2581',
    'se2582', 'se2583', 'se2584'
  ] LOOP
    SELECT id INTO legacy_id FROM transport_scopes WHERE name = '#' || token;
    IF legacy_id IS NULL THEN CONTINUE; END IF;
    SELECT id INTO canonical_id FROM transport_scopes WHERE name = token;
    IF canonical_id IS NULL THEN
      UPDATE transport_scopes SET name = token WHERE id = legacy_id;
    ELSE
      UPDATE packets SET scope_id = canonical_id WHERE scope_id = legacy_id;
      UPDATE nodes SET default_scope_id = canonical_id WHERE default_scope_id = legacy_id;
      INSERT INTO observer_scopes (observer_id, scope_id, first_seen, last_seen)
        SELECT observer_id, canonical_id, first_seen, last_seen FROM observer_scopes WHERE scope_id = legacy_id
        ON CONFLICT (observer_id, scope_id) DO UPDATE SET
          first_seen = LEAST(observer_scopes.first_seen, EXCLUDED.first_seen),
          last_seen = GREATEST(observer_scopes.last_seen, EXCLUDED.last_seen);
      DELETE FROM observer_scopes WHERE scope_id = legacy_id;
      DELETE FROM transport_scopes WHERE id = legacy_id;
    END IF;
  END LOOP;
END $$;
