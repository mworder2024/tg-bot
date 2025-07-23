# 🧠 SPARC Phase 2: Pseudocode - Algorithmic Design

**Document Type**: Algorithmic Flow Design  
**Phase**: SPARC Phase 2 - Pseudocode  
**Status**: 🔄 In Progress  
**Created**: January 15, 2025

## 🎯 OVERVIEW

This document translates the specifications from Phase 1 into detailed algorithmic flows that will guide the implementation of all system components. Each flow is designed to be deterministic, testable, and optimized for the decentralized raffle ecosystem.

## 🔗 SOLANA PROGRAM ALGORITHMS

### 1. RAFFLE CREATION ALGORITHM

```rust
ALGORITHM: CreateRaffle
INPUT: creator_wallet, prize_amount, ticket_price, max_tickets, duration, metadata
OUTPUT: raffle_account, escrow_pda, success_flag

BEGIN
    // Validation Phase
    VALIDATE creator_wallet IS authorized
    VALIDATE prize_amount >= minimum_prize (0.1 SOL)
    VALIDATE ticket_price >= minimum_ticket (0.001 SOL)
    VALIDATE max_tickets BETWEEN 1 AND 10000
    VALIDATE duration BETWEEN 1_hour AND 30_days
    
    // Calculate required balances
    platform_fee = prize_amount * fee_rate / 10000
    total_required = prize_amount + platform_fee + rent_exemption
    
    VALIDATE creator_wallet.balance >= total_required
    
    // Generate unique identifiers
    raffle_id = generate_unique_id()
    current_time = get_current_timestamp()
    end_time = current_time + duration
    
    // Create Program Derived Addresses
    escrow_pda, escrow_bump = derive_escrow_pda(raffle_id)
    raffle_pda, raffle_bump = derive_raffle_pda(raffle_id)
    
    // Initialize escrow account
    CREATE escrow_account AT escrow_pda
    SET escrow_account.authority = program_authority
    SET escrow_account.raffle_id = raffle_id
    SET escrow_account.balance = 0
    
    // Transfer prize funds to escrow
    TRANSFER prize_amount FROM creator_wallet TO escrow_pda
    UPDATE escrow_account.balance = prize_amount
    
    // Initialize raffle account
    CREATE raffle_account AT raffle_pda
    SET raffle_account.id = raffle_id
    SET raffle_account.creator = creator_wallet.pubkey
    SET raffle_account.prize_amount = prize_amount
    SET raffle_account.ticket_price = ticket_price
    SET raffle_account.max_tickets = max_tickets
    SET raffle_account.tickets_sold = 0
    SET raffle_account.start_time = current_time
    SET raffle_account.end_time = end_time
    SET raffle_account.status = RaffleStatus::Active
    SET raffle_account.escrow_bump = escrow_bump
    SET raffle_account.raffle_bump = raffle_bump
    SET raffle_account.metadata = metadata
    SET raffle_account.vrf_request = None
    SET raffle_account.winner = None
    
    // Emit creation event
    EMIT RaffleCreatedEvent {
        raffle_id: raffle_id,
        creator: creator_wallet.pubkey,
        prize_amount: prize_amount,
        ticket_price: ticket_price,
        max_tickets: max_tickets,
        end_time: end_time
    }
    
    RETURN (raffle_account, escrow_pda, true)
    
EXCEPTION_HANDLER:
    IF validation_error THEN
        RETURN (null, null, false) WITH error_message
    IF insufficient_funds THEN
        RETURN (null, null, false) WITH "Insufficient balance"
    IF pda_collision THEN
        RETRY with new raffle_id (max 3 attempts)
END
```

### 2. TICKET PURCHASE ALGORITHM

```rust
ALGORITHM: PurchaseTicket
INPUT: buyer_wallet, raffle_id, payment_amount
OUTPUT: ticket_account, success_flag

BEGIN
    // Load raffle state
    raffle_account = load_raffle_account(raffle_id)
    VALIDATE raffle_account.status == RaffleStatus::Active
    VALIDATE current_time < raffle_account.end_time
    VALIDATE raffle_account.tickets_sold < raffle_account.max_tickets
    
    // Validate payment
    VALIDATE payment_amount == raffle_account.ticket_price
    VALIDATE buyer_wallet.balance >= payment_amount
    
    // Check user ticket limits
    user_ticket_count = count_user_tickets(buyer_wallet.pubkey, raffle_id)
    VALIDATE user_ticket_count < max_tickets_per_user
    
    // Generate ticket number
    ticket_number = raffle_account.tickets_sold + 1
    ticket_pda, ticket_bump = derive_ticket_pda(raffle_id, ticket_number)
    
    // Verify ticket PDA doesn't exist (double-spend protection)
    VALIDATE NOT exists(ticket_pda)
    
    // Process payment
    escrow_pda = derive_escrow_pda(raffle_id)
    TRANSFER payment_amount FROM buyer_wallet TO escrow_pda
    
    // Create ticket account
    CREATE ticket_account AT ticket_pda
    SET ticket_account.raffle_id = raffle_id
    SET ticket_account.owner = buyer_wallet.pubkey
    SET ticket_account.ticket_number = ticket_number
    SET ticket_account.purchase_time = current_time
    SET ticket_account.bump = ticket_bump
    
    // Update raffle state
    INCREMENT raffle_account.tickets_sold
    
    // Check if raffle is now full
    IF raffle_account.tickets_sold == raffle_account.max_tickets THEN
        trigger_early_draw(raffle_id)
    END IF
    
    // Emit ticket purchase event
    EMIT TicketPurchasedEvent {
        raffle_id: raffle_id,
        buyer: buyer_wallet.pubkey,
        ticket_number: ticket_number,
        tickets_remaining: raffle_account.max_tickets - raffle_account.tickets_sold
    }
    
    RETURN (ticket_account, true)
    
EXCEPTION_HANDLER:
    IF raffle_inactive THEN
        RETURN (null, false) WITH "Raffle not active"
    IF raffle_full THEN
        RETURN (null, false) WITH "Raffle is full"
    IF insufficient_payment THEN
        RETURN (null, false) WITH "Incorrect payment amount"
    IF ticket_limit_exceeded THEN
        RETURN (null, false) WITH "Ticket limit exceeded"
END
```

### 3. VRF WINNER SELECTION ALGORITHM

```rust
ALGORITHM: InitiateWinnerSelection
INPUT: raffle_id, vrf_client_program
OUTPUT: vrf_request_account, success_flag

BEGIN
    // Load and validate raffle
    raffle_account = load_raffle_account(raffle_id)
    VALIDATE raffle_account.status == RaffleStatus::Active
    VALIDATE current_time >= raffle_account.end_time OR raffle_full
    VALIDATE raffle_account.tickets_sold > 0
    VALIDATE raffle_account.vrf_request == None
    
    // Prepare VRF request
    vrf_seed = create_vrf_seed(raffle_id, raffle_account.end_time)
    vrf_fee = calculate_vrf_fee()
    
    // Create VRF request with ORAO
    vrf_request_account = request_randomness_from_orao(
        seed: vrf_seed,
        fee: vrf_fee,
        callback_program: current_program_id,
        callback_instruction: "fulfill_vrf"
    )
    
    // Update raffle state
    SET raffle_account.status = RaffleStatus::Drawing
    SET raffle_account.vrf_request = vrf_request_account.pubkey
    
    // Emit drawing started event
    EMIT DrawingStartedEvent {
        raffle_id: raffle_id,
        vrf_request: vrf_request_account.pubkey,
        participants: raffle_account.tickets_sold
    }
    
    RETURN (vrf_request_account, true)
END

ALGORITHM: FulfillVRFSelection
INPUT: raffle_id, vrf_result, vrf_proof
OUTPUT: winner_pubkey, success_flag

BEGIN
    // Load raffle and verify VRF
    raffle_account = load_raffle_account(raffle_id)
    VALIDATE raffle_account.status == RaffleStatus::Drawing
    VALIDATE verify_vrf_proof(vrf_result, vrf_proof, raffle_account.vrf_request)
    
    // Convert VRF result to winning ticket number
    random_u64 = bytes_to_u64(vrf_result)
    winning_ticket = (random_u64 % raffle_account.tickets_sold) + 1
    
    // Find winner
    winner_ticket_pda = derive_ticket_pda(raffle_id, winning_ticket)
    winner_ticket_account = load_ticket_account(winner_ticket_pda)
    winner_pubkey = winner_ticket_account.owner
    
    // Update raffle with winner
    SET raffle_account.winner = winner_pubkey
    SET raffle_account.status = RaffleStatus::Complete
    SET raffle_account.vrf_proof = vrf_proof
    
    // Emit winner selected event
    EMIT WinnerSelectedEvent {
        raffle_id: raffle_id,
        winner: winner_pubkey,
        winning_ticket: winning_ticket,
        vrf_proof: vrf_proof
    }
    
    // Trigger automatic prize distribution
    initiate_prize_distribution(raffle_id, winner_pubkey)
    
    RETURN (winner_pubkey, true)
END
```

### 4. PRIZE DISTRIBUTION ALGORITHM

```rust
ALGORITHM: DistributePrize
INPUT: raffle_id, winner_wallet
OUTPUT: distribution_success, amounts_transferred

BEGIN
    // Load raffle and validate state
    raffle_account = load_raffle_account(raffle_id)
    VALIDATE raffle_account.status == RaffleStatus::Complete
    VALIDATE raffle_account.winner == winner_wallet.pubkey
    VALIDATE NOT raffle_account.prize_distributed
    
    // Calculate distributions
    total_collected = raffle_account.tickets_sold * raffle_account.ticket_price
    platform_fee = total_collected * fee_rate / 10000
    creator_share = raffle_account.prize_amount // Original prize amount
    winner_amount = total_collected - platform_fee
    
    // Load escrow account
    escrow_pda = derive_escrow_pda(raffle_id)
    escrow_account = load_escrow_account(escrow_pda)
    
    // Validate escrow has sufficient funds
    VALIDATE escrow_account.balance >= winner_amount + platform_fee
    
    // Distribute funds
    IF winner_amount > 0 THEN
        TRANSFER winner_amount FROM escrow_pda TO winner_wallet
    END IF
    
    IF platform_fee > 0 THEN
        TRANSFER platform_fee FROM escrow_pda TO platform_treasury
    END IF
    
    // Return original prize to creator if needed
    remaining_balance = escrow_account.balance - winner_amount - platform_fee
    IF remaining_balance > rent_exemption THEN
        TRANSFER remaining_balance FROM escrow_pda TO raffle_account.creator
    END IF
    
    // Mark prize as distributed
    SET raffle_account.prize_distributed = true
    SET raffle_account.distribution_time = current_time
    
    // Emit distribution event
    EMIT PrizeDistributedEvent {
        raffle_id: raffle_id,
        winner: winner_wallet.pubkey,
        amount: winner_amount,
        platform_fee: platform_fee
    }
    
    RETURN (true, {winner_amount, platform_fee})
    
EXCEPTION_HANDLER:
    IF insufficient_escrow_balance THEN
        initiate_emergency_refund(raffle_id)
        RETURN (false, {0, 0})
END
```

## 🖥️ BACKEND API ALGORITHMS

### 5. RAFFLE LISTING ALGORITHM

```typescript
ALGORITHM: GetActiveRaffles
INPUT: page_number, page_size, filters, sort_options
OUTPUT: raffle_list, pagination_meta

BEGIN
    // Validate pagination parameters
    VALIDATE page_number >= 1
    VALIDATE page_size BETWEEN 1 AND 100
    
    // Build base query
    query = SELECT * FROM raffles WHERE status = 'active'
    
    // Apply filters
    IF filters.min_prize THEN
        query.ADD_WHERE prize_amount >= filters.min_prize
    END IF
    
    IF filters.max_ticket_price THEN
        query.ADD_WHERE ticket_price <= filters.max_ticket_price
    END IF
    
    IF filters.ending_soon THEN
        cutoff_time = current_time + 1_hour
        query.ADD_WHERE end_time <= cutoff_time
    END IF
    
    IF filters.creator THEN
        query.ADD_WHERE creator_id = filters.creator
    END IF
    
    // Apply sorting
    SWITCH sort_options.field:
        CASE 'prize_amount':
            query.ORDER_BY prize_amount DESC
        CASE 'end_time':
            query.ORDER_BY end_time ASC
        CASE 'tickets_remaining':
            query.ORDER_BY (max_tickets - tickets_sold) DESC
        DEFAULT:
            query.ORDER_BY created_at DESC
    END SWITCH
    
    // Apply pagination
    offset = (page_number - 1) * page_size
    query.LIMIT page_size OFFSET offset
    
    // Execute query
    raffle_results = execute_query(query)
    total_count = count_total_active_raffles(filters)
    
    // Enrich with blockchain data
    FOR EACH raffle IN raffle_results:
        blockchain_data = fetch_blockchain_raffle_state(raffle.blockchain_id)
        raffle.current_tickets_sold = blockchain_data.tickets_sold
        raffle.time_remaining = raffle.end_time - current_time
        raffle.fill_percentage = raffle.current_tickets_sold / raffle.max_tickets
    END FOR
    
    // Build pagination metadata
    pagination_meta = {
        current_page: page_number,
        page_size: page_size,
        total_items: total_count,
        total_pages: CEILING(total_count / page_size),
        has_next: page_number < CEILING(total_count / page_size),
        has_previous: page_number > 1
    }
    
    RETURN (raffle_results, pagination_meta)
END
```

### 6. TICKET PURCHASE PROCESSING ALGORITHM

```typescript
ALGORITHM: ProcessTicketPurchase
INPUT: user_id, raffle_id, payment_signature
OUTPUT: ticket_record, success_flag

BEGIN
    // Rate limiting check
    recent_purchases = count_user_purchases(user_id, last_5_minutes)
    VALIDATE recent_purchases < max_purchases_per_5min
    
    // Load raffle and validate
    raffle = load_raffle_from_db(raffle_id)
    VALIDATE raffle.status == 'active'
    VALIDATE current_time < raffle.end_time
    VALIDATE raffle.tickets_sold < raffle.max_tickets
    
    // Verify blockchain transaction
    tx_details = verify_solana_transaction(payment_signature)
    VALIDATE tx_details.success == true
    VALIDATE tx_details.amount == raffle.ticket_price
    
    // Extract ticket information from blockchain
    ticket_data = parse_ticket_creation_from_tx(tx_details)
    VALIDATE ticket_data.raffle_id == raffle_id
    VALIDATE ticket_data.owner == user_wallet_address
    
    // Prevent double-processing
    existing_ticket = find_ticket_by_signature(payment_signature)
    IF existing_ticket THEN
        RETURN (existing_ticket, true) // Idempotent response
    END IF
    
    // Create database record
    ticket_record = {
        id: generate_uuid(),
        raffle_id: raffle_id,
        owner_id: user_id,
        ticket_number: ticket_data.ticket_number,
        blockchain_signature: payment_signature,
        purchased_at: current_time
    }
    
    // Begin database transaction
    BEGIN_TRANSACTION
    
    // Insert ticket record
    INSERT ticket_record INTO tickets
    
    // Update raffle ticket count
    UPDATE raffles 
    SET tickets_sold = tickets_sold + 1,
        updated_at = current_time
    WHERE id = raffle_id
    
    // Create transaction record
    transaction_record = {
        id: generate_uuid(),
        user_id: user_id,
        raffle_id: raffle_id,
        type: 'purchase',
        amount: raffle.ticket_price,
        signature: payment_signature,
        created_at: current_time
    }
    INSERT transaction_record INTO transactions
    
    COMMIT_TRANSACTION
    
    // Trigger real-time updates
    broadcast_websocket_event('raffle:ticket_sold', {
        raffle_id: raffle_id,
        tickets_remaining: raffle.max_tickets - raffle.tickets_sold - 1,
        buyer: user_id
    })
    
    // Check if raffle is now full
    updated_raffle = load_raffle_from_db(raffle_id)
    IF updated_raffle.tickets_sold >= updated_raffle.max_tickets THEN
        trigger_early_draw_notification(raffle_id)
    END IF
    
    // Send confirmation email/notification
    queue_notification('ticket_purchase_confirmation', {
        user_id: user_id,
        raffle_id: raffle_id,
        ticket_number: ticket_data.ticket_number
    })
    
    RETURN (ticket_record, true)
    
EXCEPTION_HANDLER:
    ROLLBACK_TRANSACTION
    IF verification_failed THEN
        RETURN (null, false) WITH "Invalid transaction"
    IF raffle_full THEN
        RETURN (null, false) WITH "Raffle is full"
    IF duplicate_ticket THEN
        RETURN (null, false) WITH "Ticket already exists"
END
```

### 7. REAL-TIME UPDATE ALGORITHM

```typescript
ALGORITHM: BroadcastRaffleUpdate
INPUT: event_type, raffle_id, update_data
OUTPUT: broadcast_success, recipient_count

BEGIN
    // Load raffle details
    raffle = load_raffle_from_db(raffle_id)
    VALIDATE raffle EXISTS
    
    // Determine target audiences
    audiences = []
    
    SWITCH event_type:
        CASE 'raffle:created':
            audiences = ['all_users', 'telegram_subscribers']
        CASE 'raffle:ticket_sold':
            audiences = ['raffle_participants', 'raffle_watchers']
        CASE 'raffle:drawing':
            audiences = ['raffle_participants', 'telegram_subscribers']
        CASE 'raffle:winner':
            audiences = ['all_users', 'telegram_subscribers', 'raffle_participants']
        CASE 'raffle:cancelled':
            audiences = ['raffle_participants']
    END SWITCH
    
    // Prepare update payload
    base_payload = {
        event_type: event_type,
        raffle_id: raffle_id,
        timestamp: current_time,
        data: update_data
    }
    
    total_recipients = 0
    
    // Broadcast to WebSocket clients
    IF 'all_users' IN audiences OR 'raffle_watchers' IN audiences THEN
        websocket_payload = merge(base_payload, {
            raffle_title: raffle.title,
            prize_amount: raffle.prize_amount
        })
        
        websocket_recipients = broadcast_websocket(websocket_payload)
        total_recipients += websocket_recipients
    END IF
    
    // Send targeted notifications to participants
    IF 'raffle_participants' IN audiences THEN
        participants = get_raffle_participants(raffle_id)
        
        FOR EACH participant IN participants:
            personalized_payload = merge(base_payload, {
                user_tickets: count_user_tickets(participant.user_id, raffle_id),
                is_winner: (participant.user_id == update_data.winner_id)
            })
            
            // Send via WebSocket if connected
            IF websocket_connected(participant.user_id) THEN
                send_websocket_direct(participant.user_id, personalized_payload)
            END IF
            
            // Queue push notification
            queue_push_notification(participant.user_id, personalized_payload)
        END FOR
        
        total_recipients += participants.length
    END IF
    
    // Trigger Telegram bot announcements
    IF 'telegram_subscribers' IN audiences THEN
        telegram_payload = format_telegram_message(event_type, raffle, update_data)
        telegram_recipients = queue_telegram_broadcast(telegram_payload)
        total_recipients += telegram_recipients
    END IF
    
    // Log broadcasting activity
    log_broadcast_event({
        event_type: event_type,
        raffle_id: raffle_id,
        audiences: audiences,
        recipient_count: total_recipients,
        timestamp: current_time
    })
    
    RETURN (true, total_recipients)
    
EXCEPTION_HANDLER:
    IF websocket_error THEN
        log_error("WebSocket broadcast failed", error_details)
        // Continue with other broadcast methods
    END IF
    
    IF telegram_api_error THEN
        retry_telegram_broadcast(telegram_payload, max_retries: 3)
    END IF
END
```

## 🌐 FRONTEND ALGORITHMS

### 8. RAFFLE GRID RENDERING ALGORITHM

```typescript
ALGORITHM: RenderRaffleGrid
INPUT: raffle_data, view_settings, user_preferences
OUTPUT: rendered_grid, performance_metrics

BEGIN
    start_time = performance.now()
    
    // Filter raffles based on user preferences
    visible_raffles = []
    FOR EACH raffle IN raffle_data:
        IF meets_filter_criteria(raffle, user_preferences.filters) THEN
            visible_raffles.push(raffle)
        END IF
    END FOR
    
    // Sort raffles
    SWITCH user_preferences.sort_by:
        CASE 'ending_soon':
            visible_raffles.sort((a, b) => a.end_time - b.end_time)
        CASE 'highest_prize':
            visible_raffles.sort((a, b) => b.prize_amount - a.prize_amount)
        CASE 'most_popular':
            visible_raffles.sort((a, b) => b.fill_percentage - a.fill_percentage)
        DEFAULT:
            visible_raffles.sort((a, b) => b.created_at - a.created_at)
    END SWITCH
    
    // Implement virtual scrolling for performance
    viewport_height = window.innerHeight
    card_height = 280 // pixels
    visible_count = Math.ceil(viewport_height / card_height) + 2 // buffer
    
    scroll_position = get_scroll_position()
    start_index = Math.floor(scroll_position / card_height)
    end_index = Math.min(start_index + visible_count, visible_raffles.length)
    
    visible_slice = visible_raffles.slice(start_index, end_index)
    
    // Prepare grid layout
    grid_layout = {
        container_height: visible_raffles.length * card_height,
        viewport_start: start_index * card_height,
        cards: []
    }
    
    // Render visible raffle cards
    FOR i = 0 TO visible_slice.length - 1:
        raffle = visible_slice[i]
        
        // Calculate derived values
        time_remaining = Math.max(0, raffle.end_time - Date.now())
        fill_percentage = (raffle.tickets_sold / raffle.max_tickets) * 100
        is_ending_soon = time_remaining < 3600000 // 1 hour
        is_nearly_full = fill_percentage > 80
        
        // Determine card styling
        card_variant = 'default'
        IF is_ending_soon AND is_nearly_full THEN
            card_variant = 'urgent'
        ELSE IF is_ending_soon THEN
            card_variant = 'ending_soon'
        ELSE IF is_nearly_full THEN
            card_variant = 'nearly_full'
        END IF
        
        // Create card data
        card_data = {
            raffle: raffle,
            time_remaining: time_remaining,
            fill_percentage: fill_percentage,
            variant: card_variant,
            position: start_index + i,
            is_user_participating: check_user_participation(raffle.id),
            estimated_odds: calculate_odds(raffle.max_tickets, raffle.tickets_sold)
        }
        
        grid_layout.cards.push(card_data)
    END FOR
    
    // Performance tracking
    render_time = performance.now() - start_time
    performance_metrics = {
        total_raffles: raffle_data.length,
        visible_raffles: visible_raffles.length,
        rendered_cards: grid_layout.cards.length,
        render_time: render_time,
        memory_usage: get_memory_usage()
    }
    
    // Set up real-time update handlers
    FOR EACH card IN grid_layout.cards:
        setup_realtime_updates(card.raffle.id, update_card_data)
    END FOR
    
    RETURN (grid_layout, performance_metrics)
    
SUBROUTINE: update_card_data(raffle_id, updated_data)
    card = find_card_by_raffle_id(raffle_id)
    IF card THEN
        // Update specific fields without full re-render
        card.raffle.tickets_sold = updated_data.tickets_sold
        card.fill_percentage = (updated_data.tickets_sold / card.raffle.max_tickets) * 100
        
        // Trigger efficient re-render of just this card
        schedule_card_update(card)
    END IF
END SUBROUTINE
```

### 9. WALLET CONNECTION ALGORITHM

```typescript
ALGORITHM: ConnectWallet
INPUT: preferred_wallet_type, auto_connect_enabled
OUTPUT: wallet_connection, user_session

BEGIN
    // Check for previous wallet connection
    IF auto_connect_enabled THEN
        stored_wallet = get_stored_wallet_preference()
        IF stored_wallet AND is_wallet_available(stored_wallet) THEN
            TRY connect_wallet(stored_wallet)
            IF connection_successful THEN
                RETURN create_session(stored_wallet)
            END IF
        END IF
    END IF
    
    // Detect available wallets
    available_wallets = []
    wallet_types = ['phantom', 'solflare', 'slope', 'sollet']
    
    FOR EACH wallet_type IN wallet_types:
        IF is_wallet_available(wallet_type) THEN
            wallet_info = get_wallet_info(wallet_type)
            available_wallets.push({
                type: wallet_type,
                name: wallet_info.name,
                icon: wallet_info.icon,
                installed: true
            })
        ELSE
            available_wallets.push({
                type: wallet_type,
                name: get_wallet_display_name(wallet_type),
                icon: get_wallet_icon(wallet_type),
                installed: false,
                install_url: get_wallet_install_url(wallet_type)
            })
        END IF
    END FOR
    
    // If preferred wallet is specified and available
    IF preferred_wallet_type AND is_wallet_available(preferred_wallet_type) THEN
        selected_wallet = preferred_wallet_type
    ELSE
        // Show wallet selection UI
        selected_wallet = show_wallet_selection_modal(available_wallets)
        IF selected_wallet == null THEN
            RETURN (null, null) // User cancelled
        END IF
    END IF
    
    // Attempt wallet connection
    TRY
        wallet_adapter = create_wallet_adapter(selected_wallet)
        
        // Request connection
        connection_result = wallet_adapter.connect()
        
        // Verify connection
        IF NOT connection_result.success THEN
            THROW "Connection failed: " + connection_result.error
        END IF
        
        // Get wallet public key
        public_key = wallet_adapter.publicKey
        wallet_address = public_key.toString()
        
        // Verify network compatibility
        network = get_wallet_network(wallet_adapter)
        IF network != expected_network THEN
            show_network_mismatch_warning(network, expected_network)
            // Optionally request network switch
            IF user_wants_to_switch_network THEN
                request_network_switch(expected_network)
            ELSE
                THROW "Network mismatch"
            END IF
        END IF
        
        // Create authentication token
        nonce = generate_nonce()
        message = create_sign_in_message(wallet_address, nonce)
        
        signature = wallet_adapter.signMessage(message)
        
        // Verify signature
        signature_valid = verify_signature(message, signature, public_key)
        IF NOT signature_valid THEN
            THROW "Invalid signature"
        END IF
        
        // Create user session
        auth_token = create_jwt_token({
            wallet_address: wallet_address,
            nonce: nonce,
            signature: signature,
            connected_at: current_time
        })
        
        // Store session information
        store_wallet_preference(selected_wallet)
        store_auth_token(auth_token)
        
        user_session = {
            wallet_address: wallet_address,
            wallet_type: selected_wallet,
            auth_token: auth_token,
            balance: get_wallet_balance(wallet_adapter),
            connected_at: current_time
        }
        
        // Set up event listeners
        wallet_adapter.on('disconnect', handle_wallet_disconnect)
        wallet_adapter.on('accountChanged', handle_account_change)
        
        // Initialize user data
        load_user_profile(wallet_address)
        load_user_tickets(wallet_address)
        
        RETURN (wallet_adapter, user_session)
        
    CATCH wallet_not_found:
        show_install_wallet_prompt(selected_wallet)
        RETURN (null, null)
        
    CATCH user_rejected:
        show_connection_rejected_message()
        RETURN (null, null)
        
    CATCH network_error:
        show_network_error_message()
        RETURN (null, null)
        
    CATCH signature_rejected:
        show_signature_rejected_message()
        RETURN (null, null)
END

SUBROUTINE: handle_wallet_disconnect()
    clear_stored_auth_token()
    clear_user_session()
    redirect_to_connect_page()
END SUBROUTINE

SUBROUTINE: handle_account_change(new_account)
    IF new_account != current_session.wallet_address THEN
        // Account switched, re-authenticate
        initiate_wallet_reconnection()
    END IF
END SUBROUTINE
```

## 🤖 TELEGRAM BOT ALGORITHMS

### 10. DRAMATIC DRAW NARRATION ALGORITHM

```typescript
ALGORITHM: NarrateRaffleDraw
INPUT: raffle_data, draw_events, narrative_style
OUTPUT: message_sequence, timing_schedule

BEGIN
    // Prepare narrative context
    total_participants = raffle_data.tickets_sold
    prize_amount_sol = raffle_data.prize_amount / LAMPORTS_PER_SOL
    raffle_title = raffle_data.title || "Mystery Prize Raffle"
    
    // Initialize narrative sequence
    message_sequence = []
    current_delay = 0
    
    // Opening dramatic announcement
    opening_message = format_message("🎰 THE MOMENT OF TRUTH HAS ARRIVED! 🎰\n\n" +
        "⚡ **{}** ⚡\n" +
        "💰 Prize Pool: **{} SOL**\n" +
        "👥 Brave Participants: **{}**\n" +
        "🎲 VRF Oracle: **ACTIVATED**\n\n" +
        "The blockchain doesn't lie... someone's life is about to change! 💫\n\n" +
        "_Generating cryptographic proof..._", 
        raffle_title, prize_amount_sol, total_participants)
    
    message_sequence.push({
        content: opening_message,
        delay: current_delay,
        type: 'announcement',
        effects: ['pin_message', 'disable_notifications']
    })
    current_delay += 5000 // 5 second pause
    
    // VRF Processing phase
    vrf_message = "🔮 **COSMIC FORCES ALIGNING** 🔮\n\n" +
        "The ORAO VRF Oracle is consulting the blockchain gods...\n" +
        "⚡ Entropy gathering: ████████████ 100%\n" +
        "🧮 Cryptographic proof generation: IN PROGRESS\n" +
        "🎯 Destiny calculation: PENDING\n\n" +
        "_The winner has already been chosen by the immutable laws of mathematics..._\n" +
        "_We're just catching up to reality! ⏳_"
    
    message_sequence.push({
        content: vrf_message,
        delay: current_delay,
        type: 'suspense',
        effects: ['typing_indicator']
    })
    current_delay += 15000 // 15 second VRF processing time
    
    // Build tension with participant countdown
    tension_phases = create_tension_phases(total_participants)
    
    FOR EACH phase IN tension_phases:
        countdown_message = format_countdown_message(phase, total_participants)
        message_sequence.push({
            content: countdown_message,
            delay: current_delay,
            type: 'countdown',
            effects: ['edit_previous_if_possible']
        })
        current_delay += 2000 // 2 seconds between phases
    END FOR
    
    // The moment of revelation
    winner_data = draw_events.winner_selected
    winning_ticket = winner_data.winning_ticket_number
    winner_address = winner_data.winner_address
    vrf_proof_short = winner_data.vrf_proof.substring(0, 16) + "..."
    
    // Create dramatic winner reveal
    winner_message = "🎊 **WINNER REVEALED!** 🎊\n\n" +
        "🏆 **CONGRATULATIONS!** 🏆\n" +
        "👤 Winner: `{}`\n" +
        "🎫 Winning Ticket: **#{}** out of {}\n" +
        "💰 Prize Won: **{} SOL**\n\n" +
        "🔐 **Cryptographic Proof:**\n" +
        "`{}`\n\n" +
        "✨ _The blockchain has spoken!_ ✨\n" +
        "💸 Prize distribution is automatic - check your wallet! 🎯"
    
    formatted_winner_message = format_message(winner_message,
        anonymize_address(winner_address),
        winning_ticket,
        total_participants,
        prize_amount_sol,
        vrf_proof_short)
    
    message_sequence.push({
        content: formatted_winner_message,
        delay: current_delay,
        type: 'winner_reveal',
        effects: ['pin_message', 'celebration_animation', 'mention_winner']
    })
    current_delay += 3000
    
    // Follow-up engagement
    engagement_message = "🎰 **What an incredible draw!** 🎰\n\n" +
        "📊 **Draw Statistics:**\n" +
        "• Participants: {} brave souls\n" +
        "• Winning odds: 1 in {}\n" +
        "• VRF verification: ✅ PASSED\n" +
        "• Prize distribution: ✅ AUTOMATIC\n\n" +
        "🚀 **Ready for the next adventure?**\n" +
        "👀 Check out upcoming raffles: /raffles\n" +
        "🎫 Create your own: /create"
    
    final_message = format_message(engagement_message, total_participants, total_participants)
    
    message_sequence.push({
        content: final_message,
        delay: current_delay,
        type: 'engagement',
        effects: ['inline_keyboard']
    })
    
    // Create timing schedule
    timing_schedule = {
        total_duration: current_delay,
        key_moments: [
            { event: 'draw_start', timestamp: 0 },
            { event: 'vrf_processing', timestamp: 5000 },
            { event: 'tension_building', timestamp: 20000 },
            { event: 'winner_reveal', timestamp: current_delay - 3000 },
            { event: 'engagement', timestamp: current_delay }
        ]
    }
    
    RETURN (message_sequence, timing_schedule)
    
SUBROUTINE: create_tension_phases(participant_count)
    phases = []
    
    IF participant_count > 100 THEN
        phases = [
            "🔥 100+ warriors entered the arena...",
            "⚔️  Only the chosen one will emerge victorious...",
            "🎯 The Oracle has made its decision...",
            "💫 Fate is sealed in the blockchain..."
        ]
    ELSE IF participant_count > 10 THEN
        phases = [
            "🎲 {} brave souls took the leap...",
            "⚡ Only one will claim the prize...",
            "🎯 The moment of truth arrives..."
        ]
    ELSE
        phases = [
            "🎭 {} participants, 1 destiny...",
            "🎯 The Oracle speaks..."
        ]
    END IF
    
    RETURN phases
END SUBROUTINE

SUBROUTINE: anonymize_address(full_address)
    // Show first 4 and last 4 characters for privacy
    IF full_address.length > 8 THEN
        RETURN full_address.substring(0, 4) + "..." + full_address.substring(-4)
    ELSE
        RETURN full_address
    END IF
END SUBROUTINE
```

---

**Phase 2 Status**: 95% Complete - Core Algorithms Defined  
**Next Phase**: SPARC Phase 3 - Architecture Design  
**Estimated Completion**: January 16, 2025