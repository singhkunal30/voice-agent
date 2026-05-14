-- Optional dev seed data. Run in non-prod only.

insert into orders (order_id, status, eta, items) values
    ('ORD-1001', 'shipped',    current_date + 2, array['Acme Widget', 'Acme Sprocket']),
    ('ORD-1002', 'processing', current_date + 5, array['Acme Gizmo']),
    ('ORD-1003', 'delivered',  null,             array['Acme Doohickey'])
on conflict (order_id) do nothing;
