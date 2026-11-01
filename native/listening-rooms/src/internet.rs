//! Encrypted Internet transport. Room protocol and authority remain in relay.rs.
use iroh::{
    endpoint::{presets, QuicTransportConfig},
    Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl,
};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::AsyncWriteExt,
    net::{TcpListener, TcpStream},
    runtime::Runtime,
    sync::Semaphore,
    time::timeout,
};

const ALPN: &[u8] = b"soso/rooms/1";
const WAIT: Duration = Duration::from_secs(12);
const SETUP_WAIT: Duration = Duration::from_secs(24);

pub fn parse(value: &str) -> Result<EndpointAddr, String> {
    let url = url::Url::parse(value).map_err(|_| "invalid_invitation")?;
    if url.scheme() != "iroh"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
        || url.path() != "" && url.path() != "/"
    {
        return Err("invalid_invitation".into());
    }
    let id: EndpointId = url
        .host_str()
        .ok_or("invalid_invitation")?
        .parse()
        .map_err(|_| "invalid_invitation")?;
    let pairs: Vec<_> = url.query_pairs().collect();
    if pairs.len() != 1 || pairs[0].0 != "relay" {
        return Err("invalid_invitation".into());
    }
    let relay: RelayUrl = pairs[0].1.parse().map_err(|_| "invalid_invitation")?;
    // Invitations cannot make the client dial arbitrary HTTPS or local services.
    if !iroh::defaults::prod::default_relay_map()
        .urls::<Vec<_>>()
        .contains(&relay)
    {
        return Err("invalid_invitation".into());
    }
    let mut address = EndpointAddr::new(id).with_relay_url(relay);
    // The host may switch between the same pinned public relays after a
    // network change. Keep the invitation useful across that switch.
    for relay in iroh::defaults::prod::default_relay_map().urls::<Vec<_>>() {
        address = address.with_relay_url(relay);
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invitations_accept_only_pinned_public_relays() {
        let id = iroh::SecretKey::from_bytes(&[7; 32]).public();
        let relay = iroh::defaults::prod::default_relay_map()
            .urls::<Vec<_>>()
            .remove(0);
        let mut url = url::Url::parse(&format!("iroh://{id}/")).unwrap();
        url.query_pairs_mut().append_pair("relay", relay.as_str());
        assert!(parse(url.as_str()).is_ok());
        let invitation =
            crate::client::invitation(url.as_str(), "0123456789abcdef0123456789abcdef");
        assert!(crate::client::parse_invitation(&invitation).is_ok());
        url.query_pairs_mut()
            .clear()
            .append_pair("relay", "https://127.0.0.1/");
        assert!(parse(url.as_str()).is_err());
        url.query_pairs_mut()
            .clear()
            .append_pair("relay", relay.as_str())
            .append_pair("unexpected", "value");
        assert!(parse(url.as_str()).is_err());
        assert!(parse("iroh://invalid/?relay=https://127.0.0.1/").is_err());
    }
}

pub struct Internet {
    runtime: Option<Runtime>,
    endpoint: Endpoint,
    pub address: String,
    pub port: u16,
}
impl Drop for Internet {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.block_on(async {
                let _ = timeout(Duration::from_secs(1), self.endpoint.close()).await;
            });
            runtime.shutdown_background();
        }
    }
}
fn runtime() -> Result<Runtime, String> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|_| "internet_unavailable".into())
}
async fn endpoint() -> Result<Endpoint, String> {
    // Embed the relay address in the invitation; no public DNS publication needed.
    let builder = Endpoint::builder(presets::Minimal)
        .transport_config(
            QuicTransportConfig::builder()
                .keep_alive_interval(Duration::from_secs(3))
                .max_idle_timeout(Some(
                    Duration::from_secs(75)
                        .try_into()
                        .map_err(|_| "internet_unavailable")?,
                ))
                .build(),
        )
        .relay_mode(RelayMode::Default)
        .alpns(vec![ALPN.to_vec()]);
    // Diagnostics/tests can prohibit direct paths to exercise a real public relay.
    let builder = if std::env::var("SOSO_ROOMS_RELAY_ONLY").as_deref() == Ok("1") {
        builder.clear_ip_transports()
    } else {
        builder
    };
    builder
        .bind()
        .await
        .map_err(|_| "internet_unavailable".into())
}
async fn bridge(
    connection: iroh::endpoint::Connection,
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    tcp: TcpStream,
) {
    let (mut read, mut write) = tcp.into_split();
    let _ = tokio::try_join!(
        async {
            tokio::io::copy(&mut read, &mut send).await?;
            send.finish().map_err(std::io::Error::other)?;
            Ok::<_, std::io::Error>(())
        },
        async {
            tokio::io::copy(&mut recv, &mut write).await?;
            write.shutdown().await
        }
    );
    connection.close(0u8.into(), b"room transport closed");
}
impl Internet {
    pub fn host(port: u16, key: &str) -> Result<Self, String> {
        let runtime = runtime()?;
        let setup = runtime.block_on(async {
            timeout(SETUP_WAIT, async {
                let endpoint = endpoint().await?;
                if timeout(WAIT, endpoint.online()).await.is_err() {
                    return Err("internet_unavailable".into());
                }
                let addr = endpoint.addr();
                let relay = addr.relay_urls().next().ok_or("internet_unavailable")?;
                let mut address = url::Url::parse(&format!("iroh://{}/", addr.id))
                    .map_err(|_| "internet_unavailable")?;
                address
                    .query_pairs_mut()
                    .append_pair("relay", relay.as_str());
                Ok::<_, String>((endpoint, address.to_string()))
            })
            .await
        });
        let (endpoint, address) = match setup {
            Ok(Ok(value)) => value,
            result => {
                runtime.shutdown_background();
                return Err(result
                    .ok()
                    .and_then(Result::err)
                    .unwrap_or_else(|| "internet_unavailable".into()));
            }
        };
        let acceptor = endpoint.clone();
        let key = key.as_bytes().to_vec();
        runtime.spawn(async move {
            let limit = Arc::new(Semaphore::new(32));
            while let Some(incoming) = acceptor.accept().await {
                let Ok(permit) = limit.clone().try_acquire_owned() else {
                    incoming.refuse();
                    continue;
                };
                let key = key.clone();
                tokio::spawn(async move {
                    let _permit = permit;
                    let Ok(Ok(connection)) = timeout(WAIT, incoming).await else {
                        return;
                    };
                    let Ok(Ok((mut send, mut recv))) = timeout(WAIT, connection.accept_bi()).await
                    else {
                        return;
                    };
                    let mut token = [0u8; 32];
                    if !matches!(
                        timeout(Duration::from_secs(4), recv.read_exact(&mut token)).await,
                        Ok(Ok(()))
                    ) || token.as_slice() != key.as_slice()
                    {
                        connection.close(1u8.into(), b"invalid invitation");
                        return;
                    }
                    let Ok(Ok(tcp)) = timeout(
                        Duration::from_secs(2),
                        TcpStream::connect(("127.0.0.1", port)),
                    )
                    .await
                    else {
                        return;
                    };
                    if send.write_all(b"1").await.is_err() {
                        return;
                    }
                    bridge(connection, send, recv, tcp).await;
                });
            }
        });
        Ok(Self {
            runtime: Some(runtime),
            endpoint,
            address,
            port,
        })
    }
    pub fn join(address: &str, key: &str) -> Result<Self, String> {
        let remote = parse(address)?;
        let runtime = runtime()?;
        let setup = runtime.block_on(async {
            timeout(SETUP_WAIT, async {
                let endpoint = endpoint().await?;
                let mut connection = None;
                for _ in 0..2 {
                    if let Ok(Ok(value)) = timeout(
                        Duration::from_secs(8),
                        endpoint.connect(remote.clone(), ALPN),
                    )
                    .await
                    {
                        connection = Some(value);
                        break;
                    }
                }
                let connection = connection.ok_or("internet_peer_unreachable")?;
                let (mut send, mut recv) = connection
                    .open_bi()
                    .await
                    .map_err(|_| "internet_peer_unreachable")?;
                send.write_all(key.as_bytes())
                    .await
                    .map_err(|_| "internet_peer_unreachable")?;
                let mut ack = [0u8; 1];
                timeout(Duration::from_secs(4), recv.read_exact(&mut ack))
                    .await
                    .map_err(|_| "internet_peer_unreachable")?
                    .map_err(|_| "invalid_invitation")?;
                if ack != *b"1" {
                    return Err("invalid_invitation".into());
                }
                let listener = TcpListener::bind(("127.0.0.1", 0))
                    .await
                    .map_err(|_| "internet_unavailable")?;
                Ok::<_, String>((endpoint, listener, connection, send, recv))
            })
            .await
        });
        let (endpoint, listener, connection, send, recv) = match setup {
            Ok(Ok(value)) => value,
            result => {
                runtime.shutdown_background();
                return Err(result
                    .ok()
                    .and_then(Result::err)
                    .unwrap_or_else(|| "internet_peer_unreachable".into()));
            }
        };
        let port = listener
            .local_addr()
            .map_err(|_| "internet_unavailable")?
            .port();
        runtime.spawn(async move {
            if let Ok(Ok((tcp, _))) = timeout(Duration::from_secs(5), listener.accept()).await {
                bridge(connection, send, recv, tcp).await;
            }
        });
        Ok(Self {
            runtime: Some(runtime),
            endpoint,
            address: address.into(),
            port,
        })
    }
}
